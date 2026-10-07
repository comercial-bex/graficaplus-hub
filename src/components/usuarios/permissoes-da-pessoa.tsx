import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, ChevronDown, History, Info, Minus, Plus, Search, Undo2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/bex/StatusChip";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { dicaAcao, dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { chavesUsadasNaTela } from "@/domain/acesso/uso-na-tela";
import {
  agruparPorModulo,
  ehAdministrador,
  expiraEmDoUltimoDia,
  fazAlgo,
  filtrarChaves,
  hojeNaCasa,
  motivoParaNaoTerExcecao,
  NOME_DO_PAPEL,
  nomeDaChave,
  origemDaChave,
  primeiroNome,
  resumoDaPessoa,
  rotuloDaOrigem,
  textoDaDataHora,
  textoDoEvento,
  type ChaveDaPessoa,
  type Filtro,
  type PermissoesDaPessoa,
  type UsoNoBanco,
} from "@/domain/acesso/permissoes-por-pessoa";
import {
  buscarPermissoesDaPessoa,
  buscarUsoNoBanco,
  definirExcecao,
  removerExcecao,
} from "@/lib/api/permissoes-por-pessoa";

/**
 * Painel "Permissões" de uma pessoa, aberto pela lista da equipe (/usuarios).
 *
 * Quem vê: só o administrador. A lista da equipe já é só dele (o servidor
 * confere o papel admin antes de listar), as funções do banco recusam
 * qualquer outro papel, e o motivo de uma exceção pode ser assunto delicado
 * ("de férias", "saiu do caixa") — não é para colega ler. Quem não é admin
 * não chega aqui; o que vale para ele já aparece no menu e nos botões.
 */

export type EstadoDoUso =
  | { estado: "carregando" }
  | { estado: "ok"; mapa: UsoNoBanco }
  | { estado: "erro"; erro: unknown; tentarDeNovo?: () => void };

type Acao =
  | { tipo: "dar" | "tirar"; chave: ChaveDaPessoa }
  | { tipo: "desfazer"; chave: ChaveDaPessoa };

const ROTA = "/usuarios";

/* -------------------------------------------------------------------------- */
/* Container: busca no banco, grava e recarrega                               */
/* -------------------------------------------------------------------------- */

export function PermissoesDaPessoaSheet({
  pessoa,
  onFechar,
}: {
  pessoa: { id: string; nome: string } | null;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const aberto = pessoa !== null;
  const usadasNaTela = useMemo(() => chavesUsadasNaTela(), []);

  const consulta = useQuery({
    queryKey: ["permissoes-da-pessoa", pessoa?.id],
    queryFn: () => buscarPermissoesDaPessoa(pessoa!.id),
    enabled: aberto,
  });

  // A medição do banco (policies, funções e views que citam cada chave) é a
  // mesma para todo mundo e muda só com migração: guarda por 10 minutos.
  const uso = useQuery({
    queryKey: ["permissoes-uso-no-banco"],
    queryFn: buscarUsoNoBanco,
    enabled: aberto,
    staleTime: 10 * 60_000,
  });

  const estadoDoUso: EstadoDoUso = uso.isError
    ? { estado: "erro", erro: uso.error, tentarDeNovo: () => uso.refetch() }
    : uso.data
      ? { estado: "ok", mapa: uso.data }
      : { estado: "carregando" };

  const recarregar = () => qc.invalidateQueries({ queryKey: ["permissoes-da-pessoa", pessoa?.id] });

  async function aoDefinir(
    chave: ChaveDaPessoa,
    concede: boolean,
    expiraEm: string | null,
    motivo: string,
  ) {
    if (!pessoa) return;
    const { efetiva } = await definirExcecao({
      usuarioId: pessoa.id,
      permissao: chave.chave,
      concede,
      expiraEm,
      motivo,
    });
    await recarregar();
    const nome = primeiroNome(pessoa.nome);
    toast.success(
      efetiva
        ? `“${nomeDaChave(chave.chave, chave.descricao)}” agora vale para ${nome}.`
        : `“${nomeDaChave(chave.chave, chave.descricao)}” não vale mais para ${nome}.`,
      { description: `${nome} vê a mudança ao recarregar a página ou voltar para a aba.` },
    );
  }

  async function aoDesfazer(chave: ChaveDaPessoa, motivo: string) {
    if (!pessoa) return;
    const { efetiva } = await removerExcecao({
      usuarioId: pessoa.id,
      permissao: chave.chave,
      motivo,
    });
    await recarregar();
    toast.success(`${primeiroNome(pessoa.nome)} voltou ao que o papel dá.`, {
      description: `“${nomeDaChave(chave.chave, chave.descricao)}” ${efetiva ? "continua valendo pelo papel" : "não vale mais"}.`,
    });
  }

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b border-border px-4 py-4 pr-12 text-left sm:px-6">
          <SheetTitle>Permissões de {pessoa ? primeiroNome(pessoa.nome) : ""}</SheetTitle>
          <SheetDescription>
            O que vale para esta pessoa, de onde vem cada permissão, e o que só ela ganhou ou
            perdeu.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 py-4 sm:px-6">
          {consulta.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Carregando as permissões de {pessoa?.nome}…
            </p>
          ) : consulta.isError ? (
            <FalhaDeConsulta
              titulo="Não deu para carregar as permissões desta pessoa"
              erro={consulta.error}
              onTentarDeNovo={() => consulta.refetch()}
            />
          ) : consulta.data ? (
            <PainelDePermissoes
              dados={consulta.data}
              uso={estadoDoUso}
              usadasNaTela={usadasNaTela}
              podeEditar
              onDefinir={aoDefinir}
              onDesfazer={aoDesfazer}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* O painel em si (só desenha; recebe tudo pronto)                            */
/* -------------------------------------------------------------------------- */

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "valendo", rotulo: "Valendo" },
  { valor: "excecoes", rotulo: "Com exceção" },
  { valor: "sem_efeito", rotulo: "Ainda não fazem nada" },
];

export function PainelDePermissoes({
  dados,
  uso,
  usadasNaTela,
  podeEditar,
  onDefinir,
  onDesfazer,
}: {
  dados: PermissoesDaPessoa;
  uso: EstadoDoUso;
  usadasNaTela: ReadonlySet<string>;
  /** Quem olha é administrador (espelho de has_role admin nas funções do banco). */
  podeEditar: boolean;
  onDefinir: (
    chave: ChaveDaPessoa,
    concede: boolean,
    expiraEm: string | null,
    motivo: string,
  ) => Promise<void>;
  onDesfazer: (chave: ChaveDaPessoa, motivo: string) => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [historicoInteiro, setHistoricoInteiro] = useState(false);

  const { pessoa } = dados;
  const nome = primeiroNome(pessoa.nome);
  const admin = ehAdministrador(pessoa.papeis);
  const impedimento = motivoParaNaoTerExcecao(pessoa.papeis);
  const mexe = podeEditar && impedimento === null;
  const mapaDeUso = uso.estado === "ok" ? uso.mapa : null;
  const semEfeito = (chave: string) => fazAlgo(chave, mapaDeUso, usadasNaTela) === false;
  const totalSemEfeito = mapaDeUso ? dados.chaves.filter((c) => semEfeito(c.chave)).length : null;

  const resumo = resumoDaPessoa(dados);
  const modulos = agruparPorModulo(filtrarChaves(dados.chaves, filtro, busca, semEfeito));
  const descricaoDe = new Map(dados.chaves.map((c) => [c.chave, c.descricao]));
  const historico = historicoInteiro ? dados.historico : dados.historico.slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Quem é e o resumo */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-semibold">{pessoa.nome}</span>
          {pessoa.papeis.length === 0 ? (
            <StatusChip label="sem papel" tone="muted" />
          ) : (
            pessoa.papeis.map((p) => (
              <StatusChip key={p} label={NOME_DO_PAPEL[p] ?? p} tone="cyan" />
            ))
          )}
          {!pessoa.ativo && <StatusChip label="desativada" tone="magenta" />}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Numero rotulo="valendo" valor={`${resumo.valendo} de ${resumo.total}`} />
          <Numero
            rotulo="dadas só para ela"
            valor={String(resumo.dadas)}
            destaque={resumo.dadas > 0 ? "lime" : undefined}
          />
          <Numero
            rotulo="tiradas dela"
            valor={String(resumo.tiradas)}
            destaque={resumo.tiradas > 0 ? "magenta" : undefined}
          />
        </div>

        {!pessoa.ativo && (
          <Alert>
            <Ban className="h-4 w-4" />
            <AlertDescription>
              Pessoa desativada: enquanto estiver desativada, nenhuma permissão vale — nem as do
              papel, nem as exceções.
            </AlertDescription>
          </Alert>
        )}
        {impedimento && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              {admin
                ? "Administrador tem todas as permissões, sempre. Exceção não vale para ele, nem para dar nem para tirar."
                : impedimento}
            </AlertDescription>
          </Alert>
        )}
        {!podeEditar && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Só o administrador muda permissões. Aqui você só confere.
            </AlertDescription>
          </Alert>
        )}
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <span>
            Exceção vale onde o sistema confere permissão. Algumas regras ainda olham só o papel
            (cadastrar e apagar cliente, por exemplo).
          </span>
          <DicaIcone texto={dicaCampo(ROTA, "so_o_papel")} rotulo="Onde a exceção vale" />
        </p>
      </section>

      {/* Como ler os selos */}
      <section
        aria-label="Como ler"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"
      >
        <Legenda label="do papel" tone="muted" dica={dicaCampo(ROTA, "do_papel")} />
        <Legenda label="dada só para esta pessoa" tone="lime" dica={dicaAcao(ROTA, "dar")} />
        <Legenda label="tirada desta pessoa" tone="magenta" dica={dicaAcao(ROTA, "tirar")} />
        <Legenda label="vence em dd/mm" tone="amber" dica={dicaCampo(ROTA, "vale_ate")} />
        <Legenda
          label="ainda não faz nada"
          tone="muted"
          dica={dicaCampo(ROTA, "ainda_nao_faz_nada")}
        />
      </section>

      {/* Busca e filtro */}
      <section className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar (ex.: financeiro, aprovar)"
            className="pl-9"
            aria-label="Buscar permissão"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
          {FILTROS.map((f) => {
            const desabilitado = f.valor === "sem_efeito" && uso.estado !== "ok";
            const ativo = filtro === f.valor;
            return (
              <button
                key={f.valor}
                type="button"
                disabled={desabilitado}
                aria-pressed={ativo}
                onClick={() => setFiltro(f.valor)}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50",
                  ativo
                    ? "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/15 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f.rotulo}
                {f.valor === "sem_efeito" && totalSemEfeito !== null ? ` (${totalSemEfeito})` : ""}
              </button>
            );
          })}
        </div>
        {uso.estado === "erro" && (
          <FalhaDeConsulta
            titulo="Não deu para conferir quais permissões ainda não fazem nada"
            erro={uso.erro}
            onTentarDeNovo={uso.tentarDeNovo}
          />
        )}
      </section>

      {/* Por módulo */}
      <section className="space-y-3">
        {modulos.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma permissão com esse filtro{busca.trim() ? ` e a busca "${busca.trim()}"` : ""}.
          </p>
        )}
        {modulos.map((m) => (
          <details key={m.dominio} open className="group rounded-lg border border-border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 sm:px-4 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 text-sm font-semibold">{m.nome}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {m.valendo} de {m.chaves.length} valendo
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {m.chaves.map((c) => (
                <LinhaDaChave
                  key={c.chave}
                  chave={c}
                  admin={admin}
                  semEfeito={semEfeito(c.chave)}
                  podeDesfazer={podeEditar}
                  podeDarOuTirar={mexe}
                  onAcao={setAcao}
                />
              ))}
            </ul>
          </details>
        ))}
      </section>

      {/* Histórico */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> Histórico desta pessoa
        </h3>
        {dados.historico.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma exceção foi dada ou tirada desta pessoa.
          </p>
        ) : (
          <ol className="space-y-2">
            {historico.map((e, i) => (
              <li
                key={`${e.quando}-${i}`}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="text-muted-foreground">{textoDaDataHora(e.quando)}</div>
                <div className="text-foreground">
                  {textoDoEvento(e, descricaoDe.get(e.permissao))}
                </div>
                {e.motivo && (
                  <div className="mt-0.5 italic text-muted-foreground">Motivo: {e.motivo}</div>
                )}
              </li>
            ))}
          </ol>
        )}
        {dados.historico.length > 6 && (
          <Button variant="ghost" size="sm" onClick={() => setHistoricoInteiro((v) => !v)}>
            {historicoInteiro ? "Mostrar menos" : `Mostrar tudo (${dados.historico.length})`}
          </Button>
        )}
      </section>

      <DialogoDaExcecao
        acao={acao}
        nome={nome}
        semEfeito={acao ? semEfeito(acao.chave.chave) : false}
        onFechar={() => setAcao(null)}
        onDefinir={onDefinir}
        onDesfazer={onDesfazer}
      />
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: "lime" | "magenta";
}) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-2">
      <div
        className={cn(
          "text-base font-bold tabular-nums",
          destaque === "lime" && "text-status-positive",
          destaque === "magenta" && "text-status-magenta",
        )}
      >
        {valor}
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">{rotulo}</div>
    </div>
  );
}

function Legenda({
  label,
  tone,
  dica,
}: {
  label: string;
  tone: "lime" | "magenta" | "amber" | "muted";
  dica?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusChip label={label} tone={tone} className="normal-case" />
      <DicaIcone texto={dica} rotulo={label} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma linha                                                                  */
/* -------------------------------------------------------------------------- */

function LinhaDaChave({
  chave: c,
  admin,
  semEfeito,
  podeDesfazer,
  podeDarOuTirar,
  onAcao,
}: {
  chave: ChaveDaPessoa;
  admin: boolean;
  semEfeito: boolean;
  /** Desfazer limpa até exceção sem efeito (numa pessoa que virou admin). */
  podeDesfazer: boolean;
  podeDarOuTirar: boolean;
  onAcao: (a: Acao) => void;
}) {
  const { origem, vencida, ignoradaPorSerAdmin } = origemDaChave(c, admin);
  const tom = origem.tipo === "dada" ? "lime" : origem.tipo === "tirada" ? "magenta" : "muted";
  const temExcecao = c.excecao !== null;
  const excecaoAtiva = Boolean(c.excecao?.ativa) && !ignoradaPorSerAdmin;

  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
      <div className="flex min-w-0 gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            c.efetiva
              ? "bg-[color:var(--bex-lime)]/20 text-status-positive"
              : "bg-muted text-muted-foreground",
          )}
          aria-label={c.efetiva ? "Vale para esta pessoa" : "Não vale para esta pessoa"}
          role="img"
        >
          {c.efetiva ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 space-y-1">
          <div className={cn("text-sm leading-snug", !c.efetiva && "text-muted-foreground")}>
            {c.descricao ?? c.chave}
          </div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">{c.chave}</div>
          <div className="flex flex-wrap gap-1">
            {origem.tipo !== "sem" && (
              <StatusChip label={rotuloDaOrigem(origem)} tone={tom} className="normal-case" />
            )}
            {(origem.tipo === "dada" || origem.tipo === "tirada") && origem.venceEm && (
              <StatusChip
                label={`vence em ${origem.venceEm}`}
                tone="amber"
                className="normal-case"
              />
            )}
            {origem.tipo === "tirada" && (
              <StatusChip
                label={
                  origem.papeis.length > 0
                    ? `o papel dá (${origem.papeis.map((p) => NOME_DO_PAPEL[p] ?? p).join(", ")})`
                    : "o papel também não dá"
                }
                tone="muted"
                className="normal-case"
              />
            )}
            {origem.tipo === "dada" && origem.papelJaDa && (
              <StatusChip label="o papel também dá" tone="muted" className="normal-case" />
            )}
            {vencida && (
              <StatusChip
                label={`${vencida.concede ? "dada" : "tirada"} até ${vencida.venceuEm} — já venceu`}
                tone="muted"
                className="normal-case"
              />
            )}
            {ignoradaPorSerAdmin && (
              <StatusChip
                label="exceção sem efeito: é administrador"
                tone="muted"
                className="normal-case"
              />
            )}
            {c.so_de_fora && (
              <StatusChip label="só do portal de fora" tone="muted" className="normal-case" />
            )}
            {semEfeito && (
              <Dica texto={dicaCampo(ROTA, "ainda_nao_faz_nada")}>
                <StatusChip label="ainda não faz nada" tone="muted" className="normal-case" />
              </Dica>
            )}
          </div>
          {temExcecao && c.excecao && (
            <p className="text-xs italic text-muted-foreground">
              “{c.excecao.motivo}” — {c.excecao.criado_por_nome ?? "direto no banco"},{" "}
              {textoDaDataHora(c.excecao.criado_em)}
            </p>
          )}
        </div>
      </div>

      {(podeDarOuTirar || (podeDesfazer && temExcecao)) && (
        <div className="flex shrink-0 flex-wrap gap-2 pl-7 sm:pl-0">
          {podeDesfazer && temExcecao && (
            <Dica texto={dicaAcao(ROTA, "desfazer")}>
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => onAcao({ tipo: "desfazer", chave: c })}
              >
                <Undo2 className="h-3.5 w-3.5" /> Desfazer
              </Button>
            </Dica>
          )}
          {podeDarOuTirar && !excecaoAtiva && c.efetiva && (
            <Dica texto={dicaAcao(ROTA, "tirar")}>
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => onAcao({ tipo: "tirar", chave: c })}
              >
                <Minus className="h-3.5 w-3.5" /> Tirar
              </Button>
            </Dica>
          )}
          {podeDarOuTirar && !excecaoAtiva && !c.efetiva && !c.so_de_fora && (
            <Dica texto={dicaAcao(ROTA, "dar")}>
              <Button
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={() => onAcao({ tipo: "dar", chave: c })}
              >
                <Plus className="h-3.5 w-3.5" /> Dar
              </Button>
            </Dica>
          )}
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmar: dar, tirar ou desfazer                                          */
/* -------------------------------------------------------------------------- */

function DialogoDaExcecao({
  acao,
  nome,
  semEfeito,
  onFechar,
  onDefinir,
  onDesfazer,
}: {
  acao: Acao | null;
  nome: string;
  semEfeito: boolean;
  onFechar: () => void;
  onDefinir: (
    chave: ChaveDaPessoa,
    concede: boolean,
    expiraEm: string | null,
    motivo: string,
  ) => Promise<void>;
  onDesfazer: (chave: ChaveDaPessoa, motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [ultimoDia, setUltimoDia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fechar = () => {
    if (enviando) return;
    setMotivo("");
    setUltimoDia("");
    setErro(null);
    onFechar();
  };

  if (!acao) return <Dialog open={false} />;

  const descricao = nomeDaChave(acao.chave.chave, acao.chave.descricao);
  const desfazendo = acao.tipo === "desfazer";
  const hoje = hojeNaCasa();
  const motivoCurto = !desfazendo && motivo.trim().length < 3;
  const dataNoPassado = !desfazendo && ultimoDia !== "" && ultimoDia < hoje;

  const titulo =
    acao.tipo === "dar"
      ? `Dar “${descricao}” a ${nome}`
      : acao.tipo === "tirar"
        ? `Tirar “${descricao}” de ${nome}`
        : `Desfazer a exceção de “${descricao}”`;

  const consequencia =
    acao.tipo === "dar"
      ? `${nome} passa a ter esta permissão mesmo que o papel não dê. Os colegas do mesmo papel não mudam.`
      : acao.tipo === "tirar"
        ? `${nome} perde esta permissão mesmo que o papel dê. Os colegas do mesmo papel continuam com ela.`
        : `${nome} volta ao que o papel dá: ${
            acao.chave.papeis.length > 0
              ? "esta permissão volta a valer"
              : "esta permissão deixa de valer"
          }.`;

  async function confirmar() {
    if (!acao) return;
    setErro(null);
    setEnviando(true);
    try {
      if (acao.tipo === "desfazer") {
        await onDesfazer(acao.chave, motivo.trim());
      } else {
        await onDefinir(
          acao.chave,
          acao.tipo === "dar",
          ultimoDia ? expiraEmDoUltimoDia(ultimoDia) : null,
          motivo.trim(),
        );
      }
      setEnviando(false);
      setMotivo("");
      setUltimoDia("");
      onFechar();
    } catch (e) {
      setEnviando(false);
      setErro(mensagemErro(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{titulo}</DialogTitle>
          <DialogDescription>{consequencia}</DialogDescription>
        </DialogHeader>

        {semEfeito && !desfazendo && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Esta permissão ainda não faz nada no sistema: {acao.tipo === "dar" ? "dar" : "tirar"}{" "}
              fica registrado, mas não muda nada até ela ser ligada.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-da-excecao" className="flex items-center gap-1.5">
              Motivo{desfazendo ? " (opcional)" : ""}
              <DicaIcone texto={dicaCampo(ROTA, "motivo")} rotulo="Motivo" />
            </Label>
            <Textarea
              id="motivo-da-excecao"
              value={motivo}
              maxLength={500}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                desfazendo
                  ? "Ex.: voltou das férias"
                  : "Ex.: cobre o caixa enquanto a Cibele está de férias"
              }
            />
          </div>
          {!desfazendo && (
            <div className="space-y-1.5">
              <Label htmlFor="vale-ate" className="flex items-center gap-1.5">
                Vale até (opcional)
                <DicaIcone texto={dicaCampo(ROTA, "vale_ate")} rotulo="Vale até" />
              </Label>
              <Input
                id="vale-ate"
                type="date"
                min={hoje}
                value={ultimoDia}
                onChange={(e) => setUltimoDia(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {ultimoDia
                  ? "Vence no fim desse dia (horário de Belém) e volta sozinha ao que o papel dá."
                  : "Em branco: vale até alguém desfazer."}
              </p>
            </div>
          )}
          {dataNoPassado && (
            <p className="text-xs text-destructive">Escolha hoje ou um dia depois de hoje.</p>
          )}
          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando || motivoCurto || dataNoPassado}>
            {enviando
              ? "Salvando…"
              : acao.tipo === "dar"
                ? "Dar só para esta pessoa"
                : acao.tipo === "tirar"
                  ? "Tirar só desta pessoa"
                  : "Desfazer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
