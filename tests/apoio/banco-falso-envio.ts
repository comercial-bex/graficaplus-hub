/**
 * Um Supabase de mentira para o "Enviar PDF ao cliente" (documento-whatsapp.functions.ts): tabelas
 * em memória, RPCs por função, e o Storage com download, upload e remove. Grava a ORDEM de tudo o
 * que foi chamado em `chamadas`, para o teste provar o que aconteceu antes de quê (por exemplo: a
 * conexão é conferida antes de qualquer upload).
 *
 * Os dois clientes (`usuario`, a sessão de quem clicou, e `admin`, a chave de serviço) olham o MESMO
 * banco; cada chamada leva o prefixo de quem a fez ("usuario:" ou "admin:").
 *
 * Não é um teste (o nome não termina em .test.ts).
 */

type Linha = Record<string, unknown>;
type Erro = { message: string; code?: string };
type Resposta = { data: any; error: Erro | null };
type FnRpc = (args: Record<string, unknown>, quem: string) => unknown;

export class BancoFalsoEnvio {
  tabelas: Record<string, Linha[]> = {};
  rpcs: Record<string, FnRpc> = {};
  /** "rpc:nome" ou "upload:bucket": a operação responde com este erro. */
  erros: Record<string, string> = {};
  /** O que está no Storage: "bucket/caminho". */
  arquivos = new Map<string, unknown>();
  chamadas: string[] = [];
  private seq = 0;

  novoId(prefixo = "gen") {
    this.seq += 1;
    return `${prefixo}-${this.seq}`;
  }

  linhas(tabela: string) {
    return (this.tabelas[tabela] ??= []);
  }

  /** Índice da 1ª chamada que contém o trecho (-1 se não houve). */
  indice(trecho: string) {
    return this.chamadas.findIndex((c) => c.includes(trecho));
  }

  houve(trecho: string) {
    return this.indice(trecho) >= 0;
  }

  /** Alguma escrita (insert, update, rpc que escreve, upload, remove)? */
  escritas() {
    return this.chamadas.filter((c) => /:(insert|update|upload|remove):|rpc:(?!has_permission|orcamento_link_publico|arquivo_do_pdf_gerado)/.test(c));
  }

  cliente(quem: "usuario" | "admin") {
    return {
      from: (tabela: string) => new Consulta(this, tabela, quem),
      rpc: async (nome: string, args: Record<string, unknown> = {}): Promise<Resposta> => {
        this.chamadas.push(`${quem}:rpc:${nome}`);
        const erro = this.erros[`rpc:${nome}`];
        if (erro) return { data: null, error: { message: erro } };
        const fn = this.rpcs[nome];
        if (!fn) return { data: null, error: { message: `function ${nome} not found`, code: "PGRST202" } };
        try {
          return { data: fn(args, quem), error: null };
        } catch (e) {
          return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
        }
      },
      storage: {
        from: (bucket: string) => ({
          download: async (caminho: string): Promise<Resposta> => {
            this.chamadas.push(`${quem}:download:${bucket}/${caminho}`);
            const chave = `${bucket}/${caminho}`;
            if (!this.arquivos.has(chave)) return { data: null, error: { message: "Object not found" } };
            return { data: this.arquivos.get(chave), error: null };
          },
          upload: async (caminho: string, corpo: unknown): Promise<Resposta> => {
            this.chamadas.push(`${quem}:upload:${bucket}/${caminho}`);
            const erro = this.erros[`upload:${bucket}`];
            if (erro) return { data: null, error: { message: erro } };
            this.arquivos.set(`${bucket}/${caminho}`, corpo);
            return { data: { path: caminho }, error: null };
          },
          remove: async (caminhos: string[]): Promise<Resposta> => {
            for (const c of caminhos) {
              this.chamadas.push(`${quem}:remove:${bucket}/${c}`);
              this.arquivos.delete(`${bucket}/${c}`);
            }
            return { data: [], error: null };
          },
        }),
      },
    };
  }
}

class Consulta implements PromiseLike<Resposta> {
  private filtros: ((l: Linha) => boolean)[] = [];
  private modo: "select" | "insert" | "update" = "select";
  private novo: Linha | null = null;
  private colunas = "*";

  constructor(
    private banco: BancoFalsoEnvio,
    private tabela: string,
    private quem: string,
  ) {}

  select(colunas = "*") {
    this.colunas = colunas;
    if (this.modo === "select") this.banco.chamadas.push(`${this.quem}:select:${this.tabela}`);
    return this;
  }
  insert(linha: Linha) {
    this.modo = "insert";
    this.novo = { id: this.banco.novoId(this.tabela), ...linha };
    this.banco.chamadas.push(`${this.quem}:insert:${this.tabela}`);
    this.banco.linhas(this.tabela).push(this.novo);
    return this;
  }
  update(valores: Linha) {
    this.modo = "update";
    this.novo = valores;
    this.banco.chamadas.push(`${this.quem}:update:${this.tabela}`);
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] === valor);
    return this;
  }
  is(coluna: string, valor: unknown) {
    this.filtros.push((l) => (l[coluna] ?? null) === valor);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle(): Promise<Resposta> {
    return this.executar().then((r) => {
      if (r.error) return r;
      const ls = r.data as Linha[];
      if (ls.length > 1) return { data: null, error: { message: "multiple rows returned" } };
      return { data: ls[0] ?? null, error: null };
    });
  }
  single(): Promise<Resposta> {
    return this.executar().then((r) => {
      if (r.error) return r;
      const ls = r.data as Linha[];
      if (ls.length !== 1) return { data: null, error: { message: `${ls.length} rows returned` } };
      return { data: ls[0], error: null };
    });
  }
  then<A = Resposta, B = never>(
    ok?: ((r: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.executar().then(ok, falha);
  }

  private projetar(l: Linha): Linha {
    if (this.colunas.trim() === "*") return { ...l };
    const saida: Linha = {};
    for (const c of this.colunas.split(",").map((x) => x.trim()).filter(Boolean)) saida[c] = l[c] ?? null;
    return saida;
  }

  private async executar(): Promise<Resposta> {
    if (this.modo === "insert") return { data: [this.projetar(this.novo!)], error: null };
    const linhas = this.banco.linhas(this.tabela).filter((l) => this.filtros.every((f) => f(l)));
    if (this.modo === "update") {
      for (const l of linhas) Object.assign(l, this.novo);
      return { data: null, error: null };
    }
    return { data: linhas.map((l) => this.projetar(l)), error: null };
  }
}
