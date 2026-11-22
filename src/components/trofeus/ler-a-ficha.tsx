import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ClipboardCopy, FileSearch, ImagePlus, Info, TriangleAlert, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import { lerFichaDoTrofeu, type ResultadoDaFicha } from "@/lib/api/trofeus-ficha.functions";
import { prepararImagem, validarArquivoDeImagem, type ImagemPreparada } from "@/lib/imagem-para-ia";
import { PRE_PROMPT_DA_FICHA, temBlocoDaFicha, type FichaLida } from "@/domain/trofeus/ficha-lida";
import { acharMaterial, compararFichaComModelo, escolhasDaFicha, modeloSugerido, type Divergencia, type EstadoDoMaterial } from "@/domain/trofeus/ficha-comparar";
import { ROTULO_DA_DECORACAO } from "@/domain/trofeus/ficha";
import { OPCOES_DE_ARTE, ROTULO_DA_LINHA, type EscolhasDaTela } from "@/domain/trofeus/tela";

/**
 * LER A FICHA (22/11/2026): o cartão da calculadora de troféu que entende a ficha de fabricação que o vendedor trouxe de
 * um gerador. Cola o bloco FICHA-BEX (sem IA, sem custo) ou anexa/cola a imagem da ficha (lida pela IA da agência) e
 * PRÉ-PREENCHE a calculadora: linha, altura, quantidade, urgência, arte e nomes individuais. Mostra o que leu, o que não
 * bate com o modelo e com o cadastro de materiais, e deixa a pessoa decidir. NADA é gravado aqui e o preço continua sendo
 * o do servidor, no modelo escolhido: peça que o modelo não tem aparece como "o preço não inclui".
 */

type Props = {
  /** Aplica os campos lidos na calculadora (só os que a ficha trouxe). */
  onUsar: (parte: Partial<EscolhasDaTela>) => void;
};

const numero = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n * 100) / 100).replace(".", ","));

const ROTULO_DA_ARTE = Object.fromEntries(OPCOES_DE_ARTE.map((o) => [o.tipo, o.titulo]));

function EstadoDoMaterialNaTabela({ estado }: { estado: EstadoDoMaterial }) {
  if (estado.estado === "nao_informado") return <span className="text-muted-foreground">material não informado</span>;
  if (estado.estado === "cadastrado") return <span className="text-muted-foreground">no cadastro</span>;
  if (estado.estado === "outra_espessura") {
    return (
      <span className="inline-flex items-center gap-1">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> no cadastro só em {estado.opcoes.join(", ")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> sem cadastro
    </span>
  );
}

function Divergencias({ lista }: { lista: Divergencia[] }) {
  if (lista.length === 0) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm" data-testid="ler-a-ficha-cabe">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> A ficha cabe no modelo escolhido: nada a mais nem a menos.
      </p>
    );
  }
  const rotulo = { impede: "Impede a conta", atencao: "O preço pode não refletir", info: "Para saber" } as const;
  return (
    <ul className="space-y-1.5" data-testid="ler-a-ficha-divergencias">
      {lista.map((d, i) => (
        <li
          key={`${d.nivel}-${i}`}
          className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm", d.nivel === "info" ? "border-border" : "border-[color:var(--warning)]")}
          data-testid="ler-a-ficha-divergencia"
          data-nivel={d.nivel}
        >
          {d.nivel === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>
            <span className="font-medium">{rotulo[d.nivel]}: </span>
            {d.texto}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ResumoDaFicha({ f }: { f: FichaLida }) {
  const itens: [string, string][] = [
    ["Linha", f.linha ? (ROTULO_DA_LINHA[f.linha] ?? f.linha) : "—"],
    ["Altura", f.alturaCm != null ? `${numero(f.alturaCm)} cm` : "—"],
    ["Largura", f.larguraCm != null ? `${numero(f.larguraCm)} cm` : "—"],
    ["Base", f.base ? `${numero(f.base.larguraCm)} × ${numero(f.base.alturaCm)} cm` : "—"],
    ["Quantidade", f.quantidade != null ? String(f.quantidade) : "—"],
    ["Urgência", f.urgente == null ? "—" : f.urgente ? "Sim" : "Não"],
    ["Arte", f.arte ? (ROTULO_DA_ARTE[f.arte] ?? f.arte) : "—"],
    ["Nomes individuais", f.nomesIndividuais != null ? String(f.nomesIndividuais) : "—"],
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4" data-testid="ler-a-ficha-resumo">
        {itens.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {f.textos.length > 0 && (
        <p className="text-sm" data-testid="ler-a-ficha-textos">
          <span className="font-medium">Textos do troféu:</span> {f.textos.map((t) => `${t.chave}: ${t.valor}`).join(" · ")}
        </p>
      )}
      {f.observacoes && (
        <p className="text-sm">
          <span className="font-medium">Observações da ficha:</span> {f.observacoes}
        </p>
      )}
    </>
  );
}

export function LerAFicha({ onUsar }: Props) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [imagem, setImagem] = useState<{ nome: string; previa: string; pronta: ImagemPreparada } | null>(null);
  const [problemaDaImagem, setProblemaDaImagem] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [modeloComparar, setModeloComparar] = useState<string | null>(null);
  const [verPrePrompt, setVerPrePrompt] = useState(false);
  const previaAtual = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previaAtual.current) URL.revokeObjectURL(previaAtual.current);
    },
    [],
  );

  const ler = useMutation({
    mutationFn: (): Promise<ResultadoDaFicha> =>
      lerFichaDoTrofeu({ data: { ...(texto.trim() ? { texto: texto.trim() } : {}), ...(imagem ? { imagem: imagem.pronta } : {}) } }),
    onSuccess: (r) => {
      if (r.estado === "ok") setModeloComparar(modeloSugerido(r.ficha, r.catalogo.modelos));
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  async function escolherArquivo(arquivo: File | null | undefined) {
    if (!arquivo) return;
    setProblemaDaImagem(null);
    const problema = validarArquivoDeImagem(arquivo);
    if (problema) {
      setProblemaDaImagem(problema);
      return;
    }
    setPreparando(true);
    try {
      const pronta = await prepararImagem(arquivo);
      if (previaAtual.current) URL.revokeObjectURL(previaAtual.current);
      const previa = URL.createObjectURL(arquivo);
      previaAtual.current = previa;
      setImagem({ nome: arquivo.name || "imagem colada", previa, pronta });
      ler.reset();
    } catch (e) {
      setProblemaDaImagem(mensagemErro(e));
    } finally {
      setPreparando(false);
    }
  }

  function tirarImagem() {
    if (previaAtual.current) URL.revokeObjectURL(previaAtual.current);
    previaAtual.current = null;
    setImagem(null);
    setProblemaDaImagem(null);
  }

  async function copiarPrePrompt() {
    try {
      await navigator.clipboard.writeText(PRE_PROMPT_DA_FICHA);
      toast.success("Pré-prompt copiado. Cole no gerador antes do pedido do cliente.");
    } catch {
      setVerPrePrompt(true);
      toast.error("Não consegui copiar sozinho. Selecione o texto que abriu e copie.");
    }
  }

  const resultado = ler.data ?? null;
  const ok = resultado && resultado.estado === "ok" ? resultado : null;
  const modelo = ok ? (ok.catalogo.modelos.find((m) => m.id === modeloComparar) ?? null) : null;
  const divergencias = useMemo(() => (ok ? compararFichaComModelo(ok.ficha, modelo, ok.catalogo) : []), [ok, modelo]);
  const bloco = temBlocoDaFicha(texto) && !imagem;
  const semNada = texto.trim().length < 5 && !imagem;

  return (
    <Card data-testid="ler-a-ficha">
      <CardContent className="space-y-3 pt-5">
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-3 text-left"
          aria-expanded={aberto}
          aria-controls="ler-a-ficha-corpo"
          onClick={() => setAberto((a) => !a)}
          data-testid="ler-a-ficha-abrir"
        >
          <FileSearch className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <span className="block text-base font-bold">Ler a ficha do troféu</span>
            <span className="block text-sm text-muted-foreground">Tem a ficha de fabricação ou a imagem do gerador? O sistema lê e preenche a calculadora. Opcional.</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden="true" />
        </button>

        {aberto && (
          <div id="ler-a-ficha-corpo" className="space-y-3" data-testid="ler-a-ficha-corpo">
            <div className="space-y-1.5">
              <label htmlFor="ler-a-ficha-texto" className="text-sm font-medium">
                Texto da ficha
              </label>
              <Textarea
                id="ler-a-ficha-texto"
                className="min-h-28 text-base"
                value={texto}
                onChange={(ev) => setTexto(ev.target.value)}
                onPaste={(ev) => {
                  const arquivo = Array.from(ev.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
                  if (arquivo) {
                    ev.preventDefault();
                    void escolherArquivo(arquivo);
                  }
                }}
                placeholder="Cole aqui o bloco FICHA-BEX que o gerador escreveu (ou o pedido do cliente). Também dá para colar uma imagem."
                data-testid="ler-a-ficha-texto"
              />
              <p className="text-sm text-muted-foreground">
                {bloco ? "Bloco FICHA-BEX encontrado: a leitura é feita sem IA e sem gasto." : "Com o bloco FICHA-BEX a leitura é sem IA e sem gasto. Com imagem ou pedido em texto livre, a IA da agência lê."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ler-a-ficha-arquivo" className="text-sm font-medium">
                Imagem da ficha (PNG, JPEG ou WEBP)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="ler-a-ficha-arquivo"
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring"
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" /> {imagem ? "Trocar a imagem" : "Anexar imagem"}
                  <input
                    id="ler-a-ficha-arquivo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(ev) => {
                      void escolherArquivo(ev.target.files?.[0]);
                      ev.target.value = "";
                    }}
                    data-testid="ler-a-ficha-arquivo"
                  />
                </label>
                {preparando && <span className="text-sm text-muted-foreground">Preparando a imagem…</span>}
              </div>
              {problemaDaImagem && (
                <p role="alert" className="flex items-start gap-2 text-sm text-destructive" data-testid="ler-a-ficha-problema-da-imagem">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {problemaDaImagem}
                </p>
              )}
              {imagem && (
                <div className="flex items-center gap-3 rounded-md border border-border p-2" data-testid="ler-a-ficha-previa">
                  <img src={imagem.previa} alt={`Prévia da ficha: ${imagem.nome}`} className="h-20 w-28 rounded object-contain" />
                  <span className="min-w-0 flex-1 truncate text-sm">{imagem.nome}</span>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={tirarImagem} aria-label="Tirar a imagem">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
              {imagem && <p className="text-sm text-muted-foreground">A imagem vai ao provedor da IA da agência só para ser lida. O sistema não a guarda.</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-11" disabled={semNada || ler.isPending || preparando} onClick={() => ler.mutate()} data-testid="ler-a-ficha-ler">
                {ler.isPending ? "Lendo a ficha…" : "Ler a ficha"}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void copiarPrePrompt()} data-testid="ler-a-ficha-copiar-prompt">
                <ClipboardCopy className="mr-2 h-4 w-4" aria-hidden="true" /> Copiar pré-prompt para o gerador
              </Button>
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setVerPrePrompt((v) => !v)} aria-expanded={verPrePrompt}>
                {verPrePrompt ? "Esconder o pré-prompt" : "Ver o pré-prompt"}
              </Button>
            </div>
            {verPrePrompt && <Textarea readOnly value={PRE_PROMPT_DA_FICHA} className="min-h-64 font-mono text-sm" aria-label="Pré-prompt para o gerador de imagem" data-testid="ler-a-ficha-pre-prompt" />}

            {resultado && resultado.estado !== "ok" && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-[color:var(--warning)] px-3 py-2 text-sm" data-testid={`ler-a-ficha-${resultado.estado}`}>
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {resultado.estado === "sem_ia" &&
                    "A leitura de imagem ainda não está ligada: falta cadastrar a chave da agência no Lovable (ANTHROPIC_API_KEY para o Claude, ou OPENAI_API_KEY). O bloco FICHA-BEX colado funciona sem a chave."}
                  {resultado.estado === "limite" && "O provedor da IA pediu um tempo. Tente de novo em um minuto."}
                  {resultado.estado === "sem_saldo" && "A conta da IA da agência está sem saldo. Avise a gerência."}
                  {resultado.estado === "falhou" && `Não consegui ler a ficha: ${resultado.detalhe}.`}
                </span>
              </div>
            )}

            {ok && (
              <section className="space-y-3 rounded-lg border border-border bg-card p-3" role="status" aria-label="O que o sistema leu na ficha" data-testid="ler-a-ficha-resultado">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-base font-semibold">O que li na ficha</h4>
                  <span className="text-sm text-muted-foreground">{ok.motor === "claude" ? "Lido pela IA (Claude)" : ok.motor === "openai" ? "Lido pela IA (OpenAI)" : "Lido do bloco FICHA-BEX, sem IA"}</span>
                </header>

                {ok.duvidas.length > 0 && (
                  <div className="space-y-1" data-testid="ler-a-ficha-duvidas">
                    <p className="text-sm font-medium">A IA não conseguiu ler direito:</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {ok.duvidas.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ok.avisos.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-sm" data-testid="ler-a-ficha-avisos">
                    {ok.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}

                <ResumoDaFicha f={ok.ficha} />

                {ok.ficha.pecas.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[38rem] text-sm">
                      <caption className="sr-only">Peças que a ficha lista</caption>
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th scope="col" className="py-1.5 pr-3 font-medium">Peça</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">Material e espessura</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">Medida (cm)</th>
                          <th scope="col" className="py-1.5 pr-3 text-right font-medium">Por troféu</th>
                          <th scope="col" className="py-1.5 font-medium">Decoração</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ok.ficha.pecas.map((p, i) => (
                          <tr key={`${p.nome}-${i}`} className="border-b border-border align-top last:border-0" data-testid="ler-a-ficha-peca">
                            <th scope="row" className="py-1.5 pr-3 text-left font-medium">{p.nome}</th>
                            <td className="py-1.5 pr-3">
                              {p.material ?? "—"} <span className="text-muted-foreground">({p.espessuraMm != null ? `${numero(p.espessuraMm)} mm` : "espessura não informada"})</span>
                              <span className="block text-sm">
                                <EstadoDoMaterialNaTabela estado={acharMaterial(p.material, p.espessuraMm, ok.catalogo.materiais)} />
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-3">
                              {numero(p.larguraCm)} × {numero(p.alturaCm)}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-medium">{p.quantidade}</td>
                            <td className="py-1.5">{p.decoracao ? ROTULO_DA_DECORACAO[p.decoracao] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="space-y-2 border-t border-border pt-3">
                  <div className="space-y-1.5">
                    <label htmlFor="ler-a-ficha-modelo" className="text-sm font-medium">
                      Comparar com o modelo
                    </label>
                    <Select value={modeloComparar ?? ""} onValueChange={(v) => setModeloComparar(v || null)}>
                      <SelectTrigger id="ler-a-ficha-modelo" className="min-h-11 sm:max-w-sm" data-testid="ler-a-ficha-modelo">
                        <SelectValue placeholder="Escolha o modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        {ok.catalogo.modelos.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Divergencias lista={divergencias} />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => {
                      onUsar(escolhasDaFicha(ok.ficha, modeloComparar));
                      // Recolhe o cartão: os campos preenchidos e o preço ficam à vista. O que foi lido continua guardado.
                      setAberto(false);
                      toast.success("Campos preenchidos. Confira o preço ao lado.");
                    }}
                    data-testid="ler-a-ficha-usar"
                  >
                    Usar na calculadora
                  </Button>
                  <p className="text-sm text-muted-foreground">Nada é gravado agora. O preço é o do modelo escolhido; peça que o modelo não tem fica fora da conta.</p>
                </div>
              </section>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
