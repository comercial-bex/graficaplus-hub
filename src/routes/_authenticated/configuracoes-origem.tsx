import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { Carregando } from "@/components/bex/Carregando";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  classificarAnuncio,
  listarAnunciosOrigem,
  listarConjuntos,
  listarPalavras,
  salvarConjunto,
  salvarPalavra,
  type AnuncioDaTela,
  type ConjuntoDaTela,
} from "@/lib/api/origem-do-contato.functions";
import { rotuloDoTipo, type TipoDeContato } from "@/domain/whatsapp/origem-do-contato";
import {
  alertaDoAnuncio,
  AVISO_MUDAR_TIPO_DO_CONJUNTO,
  filtrarAnuncios,
  haQuantoTempo,
  ordenarAnuncios,
  prever,
  validarConjunto,
  validarIdDoAnuncio,
} from "@/domain/whatsapp/origem-da-tela";

/**
 * Origem dos contatos (12/11/2026). O dono troca o criativo dos anúncios sem
 * trocar o anúncio, e organiza por conjunto: um para cliente final, outro para
 * parceiro. Por isso o tipo mora no CONJUNTO e o anúncio herda. Esta tela é a
 * tabela editável que liga um ao outro, sem código.
 *
 * O tipo é só uma etiqueta para a equipe. Não mexe em preço: o preço de
 * parceiro vale para quem tem cadastro de parceiro.
 *
 * Leitura e escrita passam por server functions que conferem
 * configuracoes.manage. Toda gravação mostra o erro do banco em texto claro e
 * nenhum botão finge sucesso.
 */
export const Route = createFileRoute("/_authenticated/configuracoes-origem")({
  head: () => ({ meta: [{ title: "Origem dos contatos — BEX PRINT OS" }] }),
  component: ConfiguracoesOrigemPage,
});

const CHAVE_ANUNCIOS = ["origem-anuncios"] as const;
const CHAVE_CONJUNTOS = ["origem-conjuntos"] as const;
const CHAVE_PALAVRAS = ["origem-palavras"] as const;

/** Campo de texto e botão da tela: 16 px e alvo de 44 px. */
const CAMPO = "min-h-11 text-base md:text-base";
const BOTAO = "min-h-11 text-base";
const SELETOR =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-70";

function ErroDaTela({ erro, aoTentar, titulo }: { erro: unknown; aoTentar: () => void; titulo: string }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-base text-foreground">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /> {titulo}
      </p>
      <p className="mt-1">{mensagemErro(erro, "Não foi possível carregar. Tente de novo.")}</p>
      <Button type="button" variant="outline" className={cn(BOTAO, "mt-3")} onClick={aoTentar}>
        Tentar de novo
      </Button>
    </div>
  );
}

function ErroDeGravacao({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-base font-medium text-destructive">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{mensagem}</span>
    </p>
  );
}

function SeloDoTipo({ tipo }: { tipo: TipoDeContato | null }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-base font-semibold text-foreground",
        tipo === "parceiro" && "border-link bg-link/10",
        tipo === "cliente_final" && "border-border bg-muted",
        !tipo && "border-warning bg-warning/15",
      )}
    >
      {rotuloDoTipo(tipo)}
    </span>
  );
}

function ConfiguracoesOrigemPage() {
  const qc = useQueryClient();
  const lerAnuncios = useServerFn(listarAnunciosOrigem);
  const lerConjuntos = useServerFn(listarConjuntos);
  const lerPalavras = useServerFn(listarPalavras);

  const anuncios = useQuery({ queryKey: CHAVE_ANUNCIOS, queryFn: () => lerAnuncios() });
  const conjuntos = useQuery({ queryKey: CHAVE_CONJUNTOS, queryFn: () => lerConjuntos() });
  const palavras = useQuery({ queryKey: CHAVE_PALAVRAS, queryFn: () => lerPalavras() });

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: CHAVE_ANUNCIOS });
    qc.invalidateQueries({ queryKey: CHAVE_CONJUNTOS });
  };

  return (
    <div className="max-w-6xl space-y-6 text-base">
      <SectionHeader
        ajuda={dicaTela("/configuracoes-origem")}
        breadcrumb="Configurações"
        title="Origem dos contatos"
        description="Diga quais anúncios trazem cliente final e quais trazem parceiro. É só uma etiqueta para a equipe."
      />

      <div className="rounded-lg border border-border bg-card p-4 text-base text-foreground">
        <p className="flex items-start gap-2">
          <Megaphone className="mt-1 h-5 w-5 shrink-0 text-link" aria-hidden="true" />
          <span>
            O tipo vale para o conjunto inteiro. Quando você troca o criativo e mantém o mesmo anúncio, nada muda aqui.
            Anúncio novo aparece na lista e você escolhe o conjunto uma vez.
          </span>
        </p>
        <p className="mt-2 text-muted-foreground">
          O preço de parceiro só vale para quem tem cadastro de parceiro. O cliente nunca vê esta etiqueta.
        </p>
      </div>

      <BlocoAnuncios
        carregando={anuncios.isLoading || conjuntos.isLoading}
        erro={anuncios.error ?? conjuntos.error}
        aoTentar={() => {
          anuncios.refetch();
          conjuntos.refetch();
        }}
        anuncios={anuncios.data ?? []}
        conjuntos={conjuntos.data ?? []}
        aoMudar={recarregar}
      />

      <BlocoConjuntos
        carregando={conjuntos.isLoading}
        erro={conjuntos.error}
        aoTentar={() => conjuntos.refetch()}
        conjuntos={conjuntos.data ?? []}
        aoMudar={recarregar}
      />

      <BlocoPalavras
        carregando={palavras.isLoading}
        erro={palavras.error}
        aoTentar={() => palavras.refetch()}
        palavras={palavras.data ?? []}
        aoMudar={() => qc.invalidateQueries({ queryKey: CHAVE_PALAVRAS })}
      />
    </div>
  );
}

// ---- Bloco A: anúncios que chegaram -----------------------------------------

function BlocoAnuncios(props: {
  carregando: boolean;
  erro: unknown;
  aoTentar: () => void;
  anuncios: AnuncioDaTela[];
  conjuntos: ConjuntoDaTela[];
  aoMudar: () => void;
}) {
  const [pausados, setPausados] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const lista = ordenarAnuncios(filtrarAnuncios(props.anuncios, pausados));
  const escondidos = props.anuncios.length - filtrarAnuncios(props.anuncios, false).length;
  const semConjunto = props.anuncios.filter((a) => a.ativo && a.motivo_sem_tipo !== "ok").length;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-xl">Anúncios que chegaram</CardTitle>
          <Button type="button" className={BOTAO} onClick={() => setCadastrando(true)}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Cadastrar anúncio pelo id
          </Button>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-foreground">
          <input
            type="checkbox"
            className="h-6 w-6 shrink-0 cursor-pointer accent-[var(--link)]"
            checked={pausados}
            onChange={(e) => setPausados(e.target.checked)}
          />
          Mostrar anúncios pausados{escondidos > 0 ? `. Há ${escondidos} escondido${escondidos > 1 ? "s" : ""}.` : ""}
        </label>
        {semConjunto > 0 && (
          <p className="text-base font-semibold text-foreground">
            {semConjunto === 1
              ? "1 anúncio ainda sem conjunto."
              : `${semConjunto} anúncios ainda sem conjunto.`}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {props.carregando ? (
          <Carregando />
        ) : props.erro ? (
          <ErroDaTela erro={props.erro} aoTentar={props.aoTentar} titulo="Não consegui carregar os anúncios" />
        ) : lista.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-base text-foreground">
            {props.anuncios.length === 0
              ? "Nenhum anúncio chegou ainda. Quando alguém clicar no anúncio e falar com você no WhatsApp, o anúncio aparece aqui sozinho. Os anúncios da conta Bex Print já estão cadastrados com o conjunto certo."
              : "Todos os anúncios estão pausados. Ligue a opção acima para ver."}
          </p>
        ) : (
          <>
            <div
              className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 px-4 text-base font-semibold text-foreground md:grid"
              aria-hidden="true"
            >
              <span>Título do anúncio</span>
              <span>Produto</span>
              <span>Conjunto</span>
              <span>Tipo</span>
              <span>Contatos</span>
            </div>
            <ul className="space-y-3">
              {lista.map((a) => (
                <LinhaDoAnuncio key={a.anuncio_id} anuncio={a} conjuntos={props.conjuntos} aoMudar={props.aoMudar} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
      <CadastrarAnuncio
        aberto={cadastrando}
        aoFechar={() => setCadastrando(false)}
        conjuntos={props.conjuntos}
        aoMudar={props.aoMudar}
      />
    </Card>
  );
}

type DadosDoAnuncio = {
  anuncioId: string;
  conjuntoId?: string | null;
  produto?: string | null;
  nomeInterno?: string | null;
  ativo?: boolean;
};

function useClassificar(aoMudar: () => void) {
  const gravar = useServerFn(classificarAnuncio);
  return useMutation({
    mutationFn: (v: DadosDoAnuncio) => gravar({ data: v }),
    onSuccess: () => aoMudar(),
  });
}

function LinhaDoAnuncio({
  anuncio: a,
  conjuntos,
  aoMudar,
}: {
  anuncio: AnuncioDaTela;
  conjuntos: ConjuntoDaTela[];
  aoMudar: () => void;
}) {
  const [produto, setProduto] = useState(a.produto ?? "");
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useClassificar(aoMudar);
  const alerta = alertaDoAnuncio(a.motivo_sem_tipo);
  const titulo = a.titulo_criativo?.trim() || a.nome_interno?.trim() || "Anúncio sem título";
  const ativos = conjuntos.filter((c) => c.ativo);
  const conjuntoAtual = conjuntos.find((c) => c.conjunto_id === a.conjunto_id);
  const opcoes = conjuntoAtual && !conjuntoAtual.ativo ? [...ativos, conjuntoAtual] : ativos;

  function falhou(e: unknown) {
    const m = mensagemErro(e, "Não foi possível salvar. Tente de novo.");
    setErro(m);
    setSalvo(false);
    toast.error(m);
  }

  function salvarProduto() {
    const novo = produto.trim();
    if (novo === (a.produto ?? "").trim()) return;
    setErro(null);
    gravar.mutate(
      { anuncioId: a.anuncio_id, produto: novo === "" ? null : novo },
      {
        onSuccess: () => setSalvo(true),
        onError: falhou,
      },
    );
  }

  function trocarConjunto(valor: string) {
    setErro(null);
    setSalvo(false);
    gravar.mutate(
      { anuncioId: a.anuncio_id, conjuntoId: valor === "" ? null : valor },
      {
        onSuccess: () => toast.success(valor === "" ? "Anúncio sem conjunto." : "Conjunto do anúncio salvo."),
        onError: falhou,
      },
    );
  }

  function alternarPausa() {
    setErro(null);
    gravar.mutate(
      { anuncioId: a.anuncio_id, ativo: !a.ativo },
      {
        onSuccess: () => toast.success(a.ativo ? "Anúncio marcado como pausado." : "Anúncio voltou para a lista."),
        onError: falhou,
      },
    );
  }

  const ocupado = gravar.isPending;

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-4 text-base text-foreground",
        alerta ? "border-warning" : "border-border",
        !a.ativo && "opacity-90",
      )}
      data-testid="linha-do-anuncio"
    >
      {alerta && (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-warning bg-warning/15 p-3 text-base font-medium text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{alerta}</span>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-start">
        <div className="min-w-0">
          <p className="break-words font-semibold">{titulo}</p>
          {a.nome_interno && a.nome_interno.trim() !== titulo && (
            <p className="break-words text-muted-foreground">{a.nome_interno}</p>
          )}
          <p className="mt-1 break-all text-muted-foreground">
            Id do anúncio <span className="select-all font-mono">{a.anuncio_id}</span>
          </p>
          {!a.ativo && <p className="mt-1 font-semibold">Pausado</p>}
        </div>

        <div className="min-w-0">
          <Label htmlFor={`produto-${a.anuncio_id}`} className="mb-1 block text-base font-semibold md:sr-only">
            Produto
          </Label>
          <Input
            id={`produto-${a.anuncio_id}`}
            className={CAMPO}
            value={produto}
            maxLength={200}
            placeholder="Vazio usa o produto padrão do conjunto"
            disabled={ocupado}
            onChange={(e) => {
              setProduto(e.target.value);
              setSalvo(false);
            }}
            onBlur={salvarProduto}
          />
          {!produto.trim() && a.produto_efetivo && (
            <p className="mt-1 text-muted-foreground">Usando: {a.produto_efetivo}</p>
          )}
          <p className="mt-1 min-h-6 text-base font-semibold" aria-live="polite">
            {ocupado ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Salvando
              </span>
            ) : salvo ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-4 w-4" aria-hidden="true" /> Salvo
              </span>
            ) : null}
          </p>
        </div>

        <div className="min-w-0">
          <Label htmlFor={`conjunto-${a.anuncio_id}`} className="mb-1 block text-base font-semibold md:sr-only">
            Conjunto de anúncios
          </Label>
          <select
            id={`conjunto-${a.anuncio_id}`}
            className={SELETOR}
            value={a.conjunto_id ?? ""}
            disabled={ocupado}
            onChange={(e) => trocarConjunto(e.target.value)}
          >
            <option value="">Sem conjunto</option>
            {opcoes.map((c) => (
              <option key={c.conjunto_id} value={c.conjunto_id}>
                {c.nome}
                {c.ativo ? "" : ". Desativado"}
              </option>
            ))}
            {a.conjunto_id && !conjuntoAtual && <option value={a.conjunto_id}>Conjunto {a.conjunto_id}</option>}
          </select>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-base font-semibold md:sr-only">Tipo</p>
          <SeloDoTipo tipo={a.tipo_efetivo} />
          <p className="mt-1 text-muted-foreground">O tipo vem do conjunto. Para mudar, escolha outro conjunto.</p>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-base font-semibold md:sr-only">Contatos</p>
          <p className="font-semibold">{a.total_contatos}</p>
          <p className="text-muted-foreground">Última vez: {haQuantoTempo(a.ultima_vez)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className={BOTAO} disabled={ocupado} onClick={alternarPausa}>
          {a.ativo ? "Marcar como pausado" : "Voltar para a lista"}
        </Button>
        <ErroDeGravacao mensagem={erro} />
      </div>
    </li>
  );
}

function CadastrarAnuncio({
  aberto,
  aoFechar,
  conjuntos,
  aoMudar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  conjuntos: ConjuntoDaTela[];
  aoMudar: () => void;
}) {
  const [id, setId] = useState("");
  const [nome, setNome] = useState("");
  const [conjunto, setConjunto] = useState("");
  const [erroId, setErroId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useClassificar(aoMudar);

  function fechar() {
    setId("");
    setNome("");
    setConjunto("");
    setErroId(null);
    setErro(null);
    aoFechar();
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const problema = validarIdDoAnuncio(id);
    setErroId(problema);
    setErro(null);
    if (problema) return;
    gravar.mutate(
      { anuncioId: id.trim(), nomeInterno: nome.trim() === "" ? null : nome.trim(), conjuntoId: conjunto === "" ? null : conjunto },
      {
        onSuccess: () => {
          toast.success("Anúncio cadastrado.");
          fechar();
        },
        onError: (err) => setErro(mensagemErro(err, "Não foi possível cadastrar o anúncio.")),
      },
    );
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto text-base">
        <DialogHeader>
          <DialogTitle className="text-xl">Cadastrar anúncio pelo id</DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">
            Use quando quiser escolher o conjunto antes de o primeiro contato chegar. O id está no Gerenciador de
            Anúncios, na coluna Identificação do anúncio.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="novo-anuncio-id" className="mb-1 block text-base font-semibold">
              Id do anúncio
            </Label>
            <Input
              id="novo-anuncio-id"
              className={cn(CAMPO, "font-mono")}
              inputMode="numeric"
              value={id}
              onChange={(e) => setId(e.target.value)}
              aria-invalid={erroId ? true : undefined}
            />
            {erroId && (
              <p role="alert" className="mt-1 text-base font-medium text-destructive">
                {erroId}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="novo-anuncio-nome" className="mb-1 block text-base font-semibold">
              Nome interno
            </Label>
            <Input
              id="novo-anuncio-nome"
              className={CAMPO}
              value={nome}
              maxLength={200}
              placeholder="Como você chama este anúncio"
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="novo-anuncio-conjunto" className="mb-1 block text-base font-semibold">
              Conjunto de anúncios
            </Label>
            <select
              id="novo-anuncio-conjunto"
              className={SELETOR}
              value={conjunto}
              onChange={(e) => setConjunto(e.target.value)}
            >
              <option value="">Sem conjunto</option>
              {conjuntos
                .filter((c) => c.ativo)
                .map((c) => (
                  <option key={c.conjunto_id} value={c.conjunto_id}>
                    {c.nome}
                  </option>
                ))}
            </select>
          </div>
          <ErroDeGravacao mensagem={erro} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className={BOTAO} onClick={fechar}>
              Voltar
            </Button>
            <Button type="submit" className={BOTAO} disabled={gravar.isPending}>
              {gravar.isPending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />} Cadastrar anúncio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Bloco B: conjuntos de anúncios -----------------------------------------

function BlocoConjuntos(props: {
  carregando: boolean;
  erro: unknown;
  aoTentar: () => void;
  conjuntos: ConjuntoDaTela[];
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<ConjuntoDaTela | "novo" | null>(null);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-xl">Conjuntos de anúncios</CardTitle>
          <Button type="button" className={BOTAO} onClick={() => setEditando("novo")}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Novo conjunto
          </Button>
        </div>
        <p className="text-base text-muted-foreground">
          O conjunto de parceiros da Meta otimiza para Cadastro. Se o clique levar ao formulário de cadastro e não ao
          WhatsApp, os contatos dele não passam por aqui.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.carregando ? (
          <Carregando />
        ) : props.erro ? (
          <ErroDaTela erro={props.erro} aoTentar={props.aoTentar} titulo="Não consegui carregar os conjuntos" />
        ) : props.conjuntos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-base text-foreground">
            Nenhum conjunto cadastrado. Crie um conjunto para cliente final e outro para parceiro, e ligue seus
            anúncios a eles. Quando você trocar o criativo mantendo o mesmo anúncio, nada precisa ser refeito.
          </p>
        ) : (
          <ul className="space-y-3">
            {props.conjuntos.map((c) => (
              <LinhaDoConjunto key={c.conjunto_id} conjunto={c} aoEditar={() => setEditando(c)} aoMudar={props.aoMudar} />
            ))}
          </ul>
        )}
      </CardContent>
      <DialogoDoConjunto
        key={editando === "novo" ? "novo" : (editando?.conjunto_id ?? "fechado")}
        alvo={editando}
        aoFechar={() => setEditando(null)}
        aoMudar={props.aoMudar}
      />
    </Card>
  );
}

function LinhaDoConjunto({
  conjunto: c,
  aoEditar,
  aoMudar,
}: {
  conjunto: ConjuntoDaTela;
  aoEditar: () => void;
  aoMudar: () => void;
}) {
  const gravar = useServerFn(salvarConjunto);
  const [erro, setErro] = useState<string | null>(null);
  const alternar = useMutation({
    mutationFn: () =>
      gravar({
        data: {
          conjuntoId: c.conjunto_id,
          nome: c.nome,
          tipo: c.tipo,
          campanhaId: c.campanha_id,
          campanhaNome: c.campanha_nome,
          produtoPadrao: c.produto_padrao,
          ativo: !c.ativo,
        },
      }),
    onSuccess: () => {
      setErro(null);
      toast.success(c.ativo ? "Conjunto desativado." : "Conjunto ativado.");
      aoMudar();
    },
    onError: (e) => {
      const m = mensagemErro(e, "Não foi possível salvar o conjunto.");
      setErro(m);
      toast.error(m);
    },
  });

  return (
    <li className="rounded-lg border border-border bg-card p-4 text-base text-foreground" data-testid="linha-do-conjunto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{c.nome}</p>
          <p className="break-all text-muted-foreground">
            Id do conjunto <span className="select-all font-mono">{c.conjunto_id}</span>
          </p>
          {c.campanha_nome && <p className="break-words text-muted-foreground">Campanha: {c.campanha_nome}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeloDoTipo tipo={c.tipo} />
          <span className="inline-flex min-h-8 items-center rounded-full border border-border px-3 text-base font-semibold">
            {c.ativo ? "Ativo" : "Desativado"}
          </span>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Produto padrão</dt>
          <dd className="break-words">{c.produto_padrao?.trim() || "Sem produto padrão"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Anúncios ligados</dt>
          <dd>{c.anuncios_ligados}</dd>
        </div>
      </dl>
      {!c.ativo && (
        <p className="mt-2 text-base text-foreground">Com o conjunto desativado, os anúncios dele ficam como Tipo a confirmar.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className={BOTAO} onClick={aoEditar}>
          Editar conjunto
        </Button>
        {c.ativo ? (
          <ConfirmarAcao
            titulo="Desativar este conjunto?"
            descricao="Os anúncios dele ficam como Tipo a confirmar até você ativar de novo ou escolher outro conjunto. Nada é apagado."
            rotuloConfirmar="Desativar"
            aoConfirmar={() => alternar.mutate()}
          >
            <Button type="button" variant="outline" className={BOTAO} disabled={alternar.isPending}>
              Desativar
            </Button>
          </ConfirmarAcao>
        ) : (
          <Button type="button" variant="outline" className={BOTAO} disabled={alternar.isPending} onClick={() => alternar.mutate()}>
            Ativar
          </Button>
        )}
        <ErroDeGravacao mensagem={erro} />
      </div>
    </li>
  );
}

function DialogoDoConjunto({
  alvo,
  aoFechar,
  aoMudar,
}: {
  alvo: ConjuntoDaTela | "novo" | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const existente = alvo && alvo !== "novo" ? alvo : null;
  const gravar = useServerFn(salvarConjunto);
  const [id, setId] = useState(existente?.conjunto_id ?? "");
  const [nome, setNome] = useState(existente?.nome ?? "");
  const [tipo, setTipo] = useState<TipoDeContato | null>(existente?.tipo ?? null);
  const [produto, setProduto] = useState(existente?.produto_padrao ?? "");
  const [campanha, setCampanha] = useState(existente?.campanha_nome ?? "");
  const [erros, setErros] = useState<Partial<Record<"conjuntoId" | "nome" | "tipo", string>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const salvar = useMutation({
    mutationFn: () =>
      gravar({
        data: {
          conjuntoId: id.trim(),
          nome: nome.trim(),
          tipo: tipo as TipoDeContato,
          campanhaId: existente?.campanha_id ?? null,
          campanhaNome: campanha.trim() === "" ? null : campanha.trim(),
          produtoPadrao: produto.trim() === "" ? null : produto.trim(),
          ativo: existente?.ativo ?? true,
        },
      }),
    onSuccess: () => {
      toast.success(existente ? "Conjunto salvo." : "Conjunto criado.");
      aoMudar();
      aoFechar();
    },
    onError: (e) => {
      setConfirmando(false);
      setErro(mensagemErro(e, "Não foi possível salvar o conjunto."));
    },
  });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = validarConjunto({ conjuntoId: id, nome, tipo });
    if (!v.ok) {
      setErros(v.erros);
      return;
    }
    setErros({});
    if (existente && tipo !== existente.tipo && !confirmando) {
      setConfirmando(true);
      return;
    }
    salvar.mutate();
  }

  const tipos: { valor: TipoDeContato; rotulo: string }[] = [
    { valor: "cliente_final", rotulo: "Cliente final" },
    { valor: "parceiro", rotulo: "Parceiro" },
  ];

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto text-base">
        <DialogHeader>
          <DialogTitle className="text-xl">{existente ? "Editar conjunto" : "Novo conjunto"}</DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">
            O id do conjunto está no Gerenciador de Anúncios, na coluna Identificação do conjunto.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="conjunto-id" className="mb-1 block text-base font-semibold">
              Id do conjunto na Meta
            </Label>
            <Input
              id="conjunto-id"
              className={cn(CAMPO, "font-mono")}
              inputMode="numeric"
              value={id}
              disabled={existente !== null}
              onChange={(e) => setId(e.target.value)}
              aria-invalid={erros.conjuntoId ? true : undefined}
            />
            {erros.conjuntoId && (
              <p role="alert" className="mt-1 text-base font-medium text-destructive">
                {erros.conjuntoId}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="conjunto-nome" className="mb-1 block text-base font-semibold">
              Nome do conjunto
            </Label>
            <Input
              id="conjunto-nome"
              className={CAMPO}
              value={nome}
              maxLength={200}
              onChange={(e) => setNome(e.target.value)}
              aria-invalid={erros.nome ? true : undefined}
            />
            {erros.nome && (
              <p role="alert" className="mt-1 text-base font-medium text-destructive">
                {erros.nome}
              </p>
            )}
          </div>
          <fieldset>
            <legend className="mb-1 text-base font-semibold">Para quem é</legend>
            <div role="radiogroup" aria-label="Para quem é o conjunto" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {tipos.map((t) => {
                const marcado = tipo === t.valor;
                return (
                  <button
                    key={t.valor}
                    type="button"
                    role="radio"
                    aria-checked={marcado}
                    onClick={() => {
                      setTipo(t.valor);
                      setConfirmando(false);
                    }}
                    className={cn(
                      "flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 px-4 text-base font-semibold text-foreground",
                      marcado ? "border-link bg-link/10" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    {marcado && <Check className="h-5 w-5" aria-hidden="true" />}
                    {t.rotulo}
                  </button>
                );
              })}
            </div>
            {erros.tipo && (
              <p role="alert" className="mt-1 text-base font-medium text-destructive">
                {erros.tipo}
              </p>
            )}
          </fieldset>
          <div>
            <Label htmlFor="conjunto-produto" className="mb-1 block text-base font-semibold">
              Produto padrão. Opcional.
            </Label>
            <Input
              id="conjunto-produto"
              className={CAMPO}
              value={produto}
              maxLength={200}
              placeholder="Usado pelos anúncios que não têm produto próprio"
              onChange={(e) => setProduto(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="conjunto-campanha" className="mb-1 block text-base font-semibold">
              Campanha. Opcional.
            </Label>
            <Input
              id="conjunto-campanha"
              className={CAMPO}
              value={campanha}
              maxLength={200}
              onChange={(e) => setCampanha(e.target.value)}
            />
          </div>
          {confirmando && (
            <p role="alert" className="rounded-md border border-warning bg-warning/15 p-3 text-base font-medium text-foreground">
              {AVISO_MUDAR_TIPO_DO_CONJUNTO}
            </p>
          )}
          <ErroDeGravacao mensagem={erro} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className={BOTAO} onClick={aoFechar}>
              Voltar
            </Button>
            <Button type="submit" className={BOTAO} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
              {confirmando ? "Confirmar mudança de tipo" : existente ? "Salvar conjunto" : "Criar conjunto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Bloco C: palavras que identificam o tipo -------------------------------

function BlocoPalavras(props: {
  carregando: boolean;
  erro: unknown;
  aoTentar: () => void;
  palavras: { palavra: string; ativo: boolean; tipo: TipoDeContato }[];
  aoMudar: () => void;
}) {
  const gravar = useServerFn(salvarPalavra);
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const previa = prever(
    nova,
    props.palavras.map((p) => p.palavra),
  );
  const existente = previa.guardada ? props.palavras.find((p) => p.palavra === previa.guardada) : undefined;
  const jaExistia = existente !== undefined;

  const mutacao = useMutation({
    mutationFn: (v: { palavra: string; tipo?: TipoDeContato; ativo?: boolean; remover?: boolean }) => gravar({ data: v }),
    onSuccess: (_r, v) => {
      setErro(null);
      if (v.remover) toast.success("Palavra removida.");
      else if (v.ativo === false) toast.success("Palavra desligada.");
      else if (jaExistia) toast.success("Tipo da palavra mudado.");
      else toast.success("Palavra salva.");
      props.aoMudar();
    },
    onError: (e) => {
      const m = mensagemErro(e, "Não foi possível salvar a palavra.");
      setErro(m);
      toast.error(m);
    },
  });

  function adicionar(tipo: TipoDeContato) {
    setErro(null);
    if (previa.erro || !previa.guardada) {
      setErro(previa.erro ?? "Escreva a palavra.");
      return;
    }
    if (existente && existente.tipo === tipo) {
      setErro(`Esta palavra já está na lista como ${rotuloDoTipo(tipo).toLowerCase()}.`);
      return;
    }
    mutacao.mutate({ palavra: previa.guardada, tipo, ativo: existente?.ativo ?? true }, { onSuccess: () => setNova("") });
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-xl">Palavras que identificam o tipo</CardTitle>
        <p className="text-base text-foreground">
          Cada palavra mostra o que a pessoa quer. Se a primeira mensagem tiver uma destas palavras e o anúncio não
          disser o tipo, o contato fica marcado conforme a palavra. Não importa acento nem letra maiúscula.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.carregando ? (
          <Carregando />
        ) : props.erro ? (
          <ErroDaTela erro={props.erro} aoTentar={props.aoTentar} titulo="Não consegui carregar as palavras" />
        ) : props.palavras.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-base text-foreground">
            Nenhuma palavra cadastrada. Sem palavras, só o anúncio e o cadastro de parceiro identificam o tipo.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {props.palavras.map((p) => (
              <li
                key={p.palavra}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border p-2 text-base text-foreground",
                  p.ativo ? "border-border bg-card" : "border-dashed border-border bg-muted",
                )}
              >
                <span className="px-1 font-semibold">
                  {p.palavra}
                  {!p.ativo && <span className="ml-2 font-normal">Desligada</span>}
                </span>
                <span className="px-1 text-base font-normal">Marca como {rotuloDoTipo(p.tipo).toLowerCase()}</span>
                <Button
                  type="button"
                  variant="outline"
                  className={BOTAO}
                  disabled={mutacao.isPending}
                  onClick={() => mutacao.mutate({ palavra: p.palavra, tipo: p.tipo, ativo: !p.ativo })}
                >
                  {p.ativo ? "Desligar" : "Ligar"}
                </Button>
                <ConfirmarAcao
                  titulo="Remover esta palavra?"
                  descricao={`A palavra ${p.palavra} deixa de marcar contato como ${rotuloDoTipo(p.tipo).toLowerCase()}. Você pode adicionar de novo depois.`}
                  rotuloConfirmar="Remover"
                  destrutivo
                  aoConfirmar={() => mutacao.mutate({ palavra: p.palavra, remover: true })}
                >
                  <Button type="button" variant="outline" className={BOTAO} disabled={mutacao.isPending}>
                    <Trash2 className="h-5 w-5" aria-hidden="true" /> Remover
                  </Button>
                </ConfirmarAcao>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Label htmlFor="nova-palavra" className="block text-base font-semibold">
            Nova palavra
          </Label>
          <Input
            id="nova-palavra"
            className={cn(CAMPO, "w-full")}
            value={nova}
            maxLength={100}
            placeholder="Por exemplo: quero comprar agora"
            onChange={(e) => {
              setNova(e.target.value);
              setErro(null);
            }}
            aria-invalid={previa.erro ? true : undefined}
            aria-describedby="nova-palavra-previa"
          />
          <p id="nova-palavra-previa" className="min-h-6 text-base text-foreground" aria-live="polite">
            {previa.erro
              ? previa.erro
              : previa.guardada
                ? existente
                  ? `Esta palavra já está na lista como ${rotuloDoTipo(existente.tipo).toLowerCase()}. Escolher o outro tipo muda a palavra de tipo.`
                  : `Será guardada assim: ${previa.guardada}`
                : ""}
          </p>
          <p className="text-base font-semibold text-foreground">O que esta palavra mostra?</p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className={cn(BOTAO, "flex-1 basis-60")}
              disabled={mutacao.isPending}
              onClick={() => adicionar("cliente_final")}
            >
              {mutacao.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-5 w-5" aria-hidden="true" />
              )}
              Marca como cliente final
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(BOTAO, "flex-1 basis-60")}
              disabled={mutacao.isPending}
              onClick={() => adicionar("parceiro")}
            >
              {mutacao.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-5 w-5" aria-hidden="true" />
              )}
              Marca como parceiro
            </Button>
          </div>
          <ErroDeGravacao mensagem={erro} />
        </div>

        <p className="text-base text-muted-foreground">
          Como o sistema decide, nesta ordem. Primeiro vale o que a equipe marcou na mão. Depois vale o anúncio. Depois
          vale uma palavra de parceiro. Depois vale o telefone de quem já está cadastrado como parceiro. Por último
          vale uma palavra de cliente final. Se a mensagem tiver palavra de parceiro e de cliente final ao mesmo tempo,
          vence a de parceiro. Sem nenhum sinal, o contato fica como Tipo a confirmar. O sistema nunca pergunta o tipo
          ao contato e o tipo não muda o preço.
        </p>
      </CardContent>
    </Card>
  );
}
