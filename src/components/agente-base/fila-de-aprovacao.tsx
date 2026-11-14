import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  aprovarRespostaDoAgente,
  arquivarRespostaDoAgente,
  salvarRespostaDoAgente,
  verificarTextoDoAgente,
  voltarARascunhoDoAgente,
  type PainelDaBase,
} from "@/lib/api/agente-base.functions";
import {
  contadorDeAprovadas,
  contarPorStatus,
  EXPLICACAO_DO_STATUS,
  explicarAviso,
  filtrarPorStatus,
  frasesGatilhoDoTexto,
  LIMITE_DE_LETRAS,
  produtosParaEscolher,
  proximaDaFila,
  ramosEmTexto,
  rotuloDaOpcaoDeProduto,
  rotuloDoProduto,
  ROTULO_DO_STATUS,
  salvarDepoisAprovar,
  SalvouMasNaoAprovou,
  TEXTO_SALVOU_MAS_NAO_APROVOU,
  type FiltroDeStatus,
} from "@/domain/agente-base/fila";
import type { RamoDaBase, RespostaDaBase } from "@/domain/agente-base/tipos";
import { AREA_DE_TEXTO, BOTAO, ErroDeGravacao, SELETOR } from "@/components/triagem/comum";
import { HistoricoDaResposta } from "./historico-da-resposta";

/**
 * A fila de aprovação: UMA resposta por vez, a mais frequente nas conversas
 * primeiro. O dono lê a pergunta em frase genérica, o ramo, o produto ou a
 * família, o texto proposto e os avisos do validador do banco, e decide.
 *
 * Não existe "aprovar tudo": cada botão Aprovar vale para a resposta que está
 * aberta, na versão que o dono está vendo. Se alguém mudou o texto no meio, o
 * banco recusa e a tela pede para ler de novo. Letra de 16 px e alvos de 44 px.
 */

const FILTROS: { valor: FiltroDeStatus; rotulo: string }[] = [
  { valor: "rascunho", rotulo: "Rascunhos" },
  { valor: "aprovada", rotulo: "Aprovadas" },
  { valor: "arquivada", rotulo: "Arquivadas" },
  { valor: "todas", rotulo: "Todas" },
];

type ModoDeRamos = "cliente" | "parceiro" | "ambos";

function ramosDoModo(m: ModoDeRamos): RamoDaBase[] {
  return m === "ambos" ? ["cliente", "parceiro"] : [m];
}

function modoDosRamos(r: readonly RamoDaBase[]): ModoDeRamos {
  if (r.length === 2) return "ambos";
  return r[0] === "parceiro" ? "parceiro" : "cliente";
}

export function FilaDeAprovacao({
  painel,
  aoMudar,
}: {
  painel: PainelDaBase;
  aoMudar: () => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDeStatus>("rascunho");
  const [idAberto, setIdAberto] = useState<string | null>(null);
  const contador = contadorDeAprovadas(painel.respostas);
  const contagens = contarPorStatus(painel.respostas);
  const lista = useMemo(() => filtrarPorStatus(painel.respostas, filtro), [painel.respostas, filtro]);
  const aberta =
    painel.respostas.find((r) => r.id === idAberto) ?? (lista.length > 0 ? lista[0] : null);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-xl">
          <span>Fila de aprovação</span>
          <span
            className="rounded-md border border-border bg-muted px-3 py-1 text-base font-semibold text-foreground"
            role="status"
          >
            {contador.texto}
          </span>
        </CardTitle>
        <p className="text-base text-foreground">
          Leia uma resposta por vez. A mais perguntada nas conversas vem primeiro. Aprovar vale só
          para a resposta que está aberta. Nada usa estas respostas ainda: aprovar não muda o que
          nenhum contato recebe.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <Button
              key={f.valor}
              type="button"
              variant={filtro === f.valor ? "default" : "outline"}
              className={BOTAO}
              aria-pressed={filtro === f.valor}
              onClick={() => {
                setFiltro(f.valor);
                setIdAberto(null);
              }}
            >
              {f.rotulo} {contagens[f.valor]}
            </Button>
          ))}
        </div>

        {lista.length === 0 ? (
          <p className="text-base text-foreground" role="status">
            {filtro === "rascunho"
              ? "Nenhum rascunho esperando. Tudo o que estava na fila já foi decidido."
              : "Nenhuma resposta nesta situação."}
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <ol className="space-y-2" aria-label="Respostas desta situação, da mais perguntada para a menos">
              {lista.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={cn(
                      "min-h-11 w-full rounded-md border px-3 py-2 text-left text-base text-foreground",
                      aberta?.id === r.id ? "border-primary bg-primary/10" : "border-border bg-card",
                    )}
                    aria-current={aberta?.id === r.id ? "true" : undefined}
                    onClick={() => setIdAberto(r.id)}
                  >
                    <span className="block font-semibold">
                      {i + 1}. {r.pergunta}
                    </span>
                    <span className="block text-muted-foreground">
                      {r.contagem_ocorrencias} conversas. {ROTULO_DO_STATUS[r.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {aberta ? (
              <RespostaAberta
                key={`${aberta.id}-${aberta.versao}-${aberta.status}`}
                resposta={aberta}
                painel={painel}
                aoMudar={aoMudar}
                aoSeguir={() => {
                  const prox = proximaDaFila(painel.respostas, aberta.id);
                  setIdAberto(prox?.id ?? null);
                  if (prox) setFiltro("rascunho");
                }}
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RespostaAberta({
  resposta,
  painel,
  aoMudar,
  aoSeguir,
}: {
  resposta: RespostaDaBase;
  painel: PainelDaBase;
  aoMudar: () => void;
  aoSeguir: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(resposta.resposta);
  const [frases, setFrases] = useState(resposta.frases_gatilho.join("\n"));
  const [modo, setModo] = useState<ModoDeRamos>(modoDosRamos(resposta.ramos));
  const [produtoId, setProdutoId] = useState<string>(resposta.produto_id ?? "");
  const [familia, setFamilia] = useState(resposta.familia ?? "");
  const [erro, setErro] = useState<string | null>(null);

  const ramos = ramosDoModo(modo);
  const textoEmUso = editando ? texto : resposta.resposta;
  const verificar = useServerFn(verificarTextoDoAgente);
  // o aviso do banco para o texto que está na tela, com um respiro para não perguntar a cada letra
  const [textoParaVerificar, setTextoParaVerificar] = useState(textoEmUso);
  useEffect(() => {
    const t = setTimeout(() => setTextoParaVerificar(textoEmUso), 400);
    return () => clearTimeout(t);
  }, [textoEmUso]);
  const avisos = useQuery({
    queryKey: ["agente-base-avisos", textoParaVerificar, ramos.join(",")],
    queryFn: () => verificar({ data: { texto: textoParaVerificar, ramos } }),
    enabled: textoParaVerificar.trim().length > 0,
  });
  const codigos = avisos.data?.avisos ?? [];
  const aVerificar = avisos.isFetching || textoParaVerificar !== textoEmUso;

  const salvar = useServerFn(salvarRespostaDoAgente);
  const aprovar = useServerFn(aprovarRespostaDoAgente);
  const voltar = useServerFn(voltarARascunhoDoAgente);
  const arquivar = useServerFn(arquivarRespostaDoAgente);

  // as frases do jeito que o banco as guarda: uma linha só com "?" não é frase e conta como zero
  const { cruas: frasesLimpas, normalizadas } = frasesGatilhoDoTexto(frases);
  const produto = painel.produtos.find((p) => p.id === produtoId) ?? null;
  // a lista de escolha tem os ativos e o produto atual da resposta, mesmo desativado
  const produtosDaLista = produtosParaEscolher(painel.produtos, resposta.produto_id, produtoId);

  const textoMudou = texto.trim() !== resposta.resposta;
  const metaMudou =
    JSON.stringify(normalizadas) !== JSON.stringify(resposta.frases_gatilho) ||
    modo !== modoDosRamos(resposta.ramos) ||
    (produtoId || null) !== resposta.produto_id ||
    (produtoId ? false : (familia.trim() || null) !== resposta.familia);

  function depois(mensagem: string, seguir = false) {
    toast.success(mensagem);
    setErro(null);
    setEditando(false);
    aoMudar();
    if (seguir) aoSeguir();
  }
  const aoFalhar = (e: unknown) => {
    if (e instanceof SalvouMasNaoAprovou) {
      // o rascunho JÁ foi salvo e a versão subiu: recarrega o painel para a tela mostrar o que está no banco.
      // O aviso vai por toast porque a recarga troca a versão e remonta esta resposta, apagando o erro local.
      const motivo = mensagemErro(e.causa, "Tente de novo.");
      toast.error(`${TEXTO_SALVOU_MAS_NAO_APROVOU}. ${motivo}`, { duration: 12000 });
      setErro(`${TEXTO_SALVOU_MAS_NAO_APROVOU}. ${motivo}`);
      setEditando(false);
      aoMudar();
      return;
    }
    setErro(mensagemErro(e, "Não foi possível concluir."));
  };

  function dadosParaSalvar() {
    return {
      id: resposta.id,
      tema: resposta.tema,
      pergunta: resposta.pergunta,
      frases: frasesLimpas,
      ramos,
      produtoId: produtoId || null,
      familia: produtoId ? null : familia.trim() || null,
      resposta: texto.trim(),
      versaoVista: resposta.versao,
    };
  }

  const salvarRascunho = useMutation({
    mutationFn: () => salvar({ data: dadosParaSalvar() }),
    onSuccess: (r) =>
      depois(
        r.voltouARascunho
          ? "Salvo. Como estava aprovada, voltou a rascunho e precisa de nova aprovação."
          : "Rascunho salvo.",
      ),
    onError: aoFalhar,
  });

  const aprovarEssa = useMutation({
    mutationFn: async () => {
      // se mexeu em frases, ramo ou produto, salva primeiro (a versão sobe) e aprova a versão nova; só o texto vai junto na aprovação
      if (editando && metaMudou) {
        return salvarDepoisAprovar(
          () => salvar({ data: dadosParaSalvar() }),
          (versaoSalva) => aprovar({ data: { id: resposta.id, versaoVista: versaoSalva, textoNovo: null } }),
        );
      }
      return aprovar({
        data: {
          id: resposta.id,
          versaoVista: resposta.versao,
          textoNovo: editando && textoMudou ? texto.trim() : null,
        },
      });
    },
    onSuccess: () => depois("Resposta aprovada.", true),
    onError: aoFalhar,
  });

  const voltarARascunho = useMutation({
    mutationFn: () => voltar({ data: { id: resposta.id } }),
    onSuccess: () => depois("A resposta voltou a rascunho."),
    onError: aoFalhar,
  });
  const arquivarEssa = useMutation({
    mutationFn: () => arquivar({ data: { id: resposta.id } }),
    onSuccess: () => depois("Resposta arquivada.", true),
    onError: aoFalhar,
  });

  const ocupado =
    salvarRascunho.isPending || aprovarEssa.isPending || voltarARascunho.isPending || arquivarEssa.isPending;
  const rascunho = resposta.status === "rascunho";
  const textoVazio = textoEmUso.trim().length === 0;
  const semFrase = (editando ? normalizadas.length : resposta.frases_gatilho.length) === 0;
  const podeAprovarAgora =
    painel.podeAprovar && rascunho && codigos.length === 0 && !aVerificar && !textoVazio && !semFrase && !ocupado;

  return (
    <article className="space-y-4 rounded-lg border border-border p-4" aria-label="Resposta aberta">
      <header className="space-y-1">
        <p className="text-base text-muted-foreground">
          {resposta.contagem_ocorrencias} conversas perguntaram algo assim. Versão {resposta.versao}.
        </p>
        <h3 className="text-xl font-semibold text-foreground">{resposta.pergunta}</h3>
        <p className="text-base text-foreground">
          <strong>{ROTULO_DO_STATUS[resposta.status]}.</strong> {EXPLICACAO_DO_STATUS[resposta.status]}
        </p>
      </header>

      <dl className="grid gap-3 text-base text-foreground sm:grid-cols-3">
        <div>
          <dt className="font-semibold">Quem recebe</dt>
          <dd>{ramosEmTexto(editando ? ramos : resposta.ramos)}</dd>
        </div>
        <div>
          <dt className="font-semibold">Produto</dt>
          <dd>
            {rotuloDoProduto(editando ? produtoId || null : resposta.produto_id, painel.produtos)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Família</dt>
          <dd>{(editando ? (produto?.familia ?? (familia.trim() || null)) : resposta.familia) ?? "Qualquer família"}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h4 className="text-base font-semibold text-foreground">Texto proposto</h4>
        {editando ? (
          <div className="space-y-1">
            <Label htmlFor="texto-proposto" className="sr-only">
              Texto proposto
            </Label>
            <textarea
              id="texto-proposto"
              className={AREA_DE_TEXTO}
              value={texto}
              maxLength={LIMITE_DE_LETRAS}
              onChange={(e) => setTexto(e.target.value)}
            />
            <p className="text-base text-muted-foreground">
              {texto.length} de {LIMITE_DE_LETRAS} letras.
            </p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-3 text-base leading-relaxed text-foreground">
            {resposta.resposta}
          </p>
        )}
      </section>

      {editando ? (
        <section className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="frases-gatilho" className="text-base font-semibold text-foreground">
              Frases que chamam esta resposta, uma por linha
            </Label>
            <textarea
              id="frases-gatilho"
              className={cn(AREA_DE_TEXTO, "min-h-28")}
              value={frases}
              onChange={(e) => setFrases(e.target.value)}
            />
            <p className="text-base text-muted-foreground">
              O sistema ignora maiúsculas, acentos e pontuação. A frase vale quando aparece na
              pergunta, em palavras inteiras.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ramo-da-resposta" className="text-base text-foreground">
              Quem recebe
            </Label>
            <select
              id="ramo-da-resposta"
              className={SELETOR}
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoDeRamos)}
            >
              <option value="cliente">Cliente final</option>
              <option value="parceiro">Parceiro</option>
              <option value="ambos">Cliente final e parceiro</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="produto-da-resposta" className="text-base text-foreground">
              Produto, se a resposta é só dele
            </Label>
            <select
              id="produto-da-resposta"
              className={SELETOR}
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
            >
              <option value="">Qualquer produto</option>
              {produtosDaLista.map((p) => (
                <option key={p.id} value={p.id}>
                  {rotuloDaOpcaoDeProduto(p)}
                </option>
              ))}
            </select>
          </div>
          {!produtoId ? (
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="familia-da-resposta" className="text-base text-foreground">
                Família, se a resposta é de um tipo de produto
              </Label>
              <select
                id="familia-da-resposta"
                className={SELETOR}
                value={familia}
                onChange={(e) => setFamilia(e.target.value)}
              >
                <option value="">Qualquer família</option>
                {[...new Set(painel.produtos.map((p) => p.familia).filter((f): f is string => !!f))]
                  .sort((a, b) => a.localeCompare(b))
                  .map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="space-y-1">
          <h4 className="text-base font-semibold text-foreground">Frases que chamam esta resposta</h4>
          <p className="text-base text-foreground">
            {resposta.frases_gatilho.length > 0
              ? resposta.frases_gatilho.join(", ")
              : "Nenhuma. Sem frase a resposta nunca seria usada."}
          </p>
        </section>
      )}

      <section aria-live="polite" className="space-y-1">
        <h4 className="text-base font-semibold text-foreground">Avisos do sistema</h4>
        {aVerificar ? (
          <p className="flex items-center gap-2 text-base text-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Conferindo o texto.
          </p>
        ) : avisos.error ? (
          <p role="alert" className="text-base font-medium text-destructive">
            {mensagemErro(avisos.error, "Não consegui conferir o texto agora. Tente de novo.")}
          </p>
        ) : codigos.length === 0 ? (
          <p className="flex items-center gap-2 text-base text-foreground">
            <Check className="h-5 w-5" aria-hidden="true" /> Nenhum aviso. O texto não fala valor,
            desconto, prazo em número nem forma de pagamento.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-6 text-base font-medium text-destructive">
            {codigos.map((c) => (
              <li key={c}>{explicarAviso(c)}</li>
            ))}
          </ul>
        )}
        {codigos.length > 0 && rascunho ? (
          <p className="text-base text-foreground">
            Com aviso, o sistema não deixa aprovar. Edite o texto até os avisos sumirem.
          </p>
        ) : null}
      </section>

      {resposta.status === "aprovada" && editando ? (
        <p className="text-base font-medium text-foreground" role="status">
          Esta resposta está aprovada. Se você salvar uma mudança, ela volta a rascunho e precisa de
          nova aprovação.
        </p>
      ) : null}
      {!painel.podeAprovar && rascunho ? (
        <p className="text-base text-foreground">
          Só o dono aprova. Você pode editar o texto e deixar o rascunho pronto.
        </p>
      ) : null}
      <ErroDeGravacao mensagem={erro} />

      <div className="flex flex-wrap gap-2">
        {editando ? (
          <>
            {painel.podeAprovar && rascunho ? (
              <ConfirmarAcao
                grande
                titulo="Aprovar o texto editado?"
                descricao="O texto que está na tela vira o texto aprovado desta resposta. Nada usa a base ainda, mas só aprove se você leu cada palavra."
                rotuloConfirmar="Sim, aprovar"
                aoConfirmar={() => aprovarEssa.mutate()}
              >
                <Button type="button" className={BOTAO} disabled={!podeAprovarAgora || (!textoMudou && !metaMudou)}>
                  {aprovarEssa.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                  Editar e aprovar
                </Button>
              </ConfirmarAcao>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className={BOTAO}
              disabled={ocupado || textoVazio || (!textoMudou && !metaMudou)}
              onClick={() => salvarRascunho.mutate()}
            >
              Salvar como rascunho
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={BOTAO}
              disabled={ocupado}
              onClick={() => {
                setEditando(false);
                setTexto(resposta.resposta);
                setFrases(resposta.frases_gatilho.join("\n"));
                setModo(modoDosRamos(resposta.ramos));
                setProdutoId(resposta.produto_id ?? "");
                setFamilia(resposta.familia ?? "");
                setErro(null);
              }}
            >
              Cancelar a edição
            </Button>
          </>
        ) : (
          <>
            {rascunho && painel.podeAprovar ? (
              <ConfirmarAcao
                grande
                titulo="Aprovar esta resposta?"
                descricao="Você está aprovando só esta resposta, no texto que está na tela. Nada usa a base ainda, mas só aprove se você leu cada palavra."
                rotuloConfirmar="Sim, aprovar"
                aoConfirmar={() => aprovarEssa.mutate()}
              >
                <Button type="button" className={BOTAO} disabled={!podeAprovarAgora}>
                  {aprovarEssa.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                  Aprovar
                </Button>
              </ConfirmarAcao>
            ) : null}
            {resposta.status !== "arquivada" ? (
              <Button type="button" variant="outline" className={BOTAO} disabled={ocupado} onClick={() => setEditando(true)}>
                {rascunho && painel.podeAprovar ? "Editar" : "Editar texto"}
              </Button>
            ) : null}
            {resposta.status === "aprovada" ? (
              <ConfirmarAcao
                grande
                titulo="Voltar a rascunho?"
                descricao="A resposta deixa de estar aprovada e precisa ser aprovada de novo para valer."
                rotuloConfirmar="Sim, voltar a rascunho"
                aoConfirmar={() => voltarARascunho.mutate()}
              >
                <Button type="button" variant="outline" className={BOTAO} disabled={ocupado}>
                  Voltar a rascunho
                </Button>
              </ConfirmarAcao>
            ) : null}
            {resposta.status === "arquivada" ? (
              <Button type="button" variant="outline" className={BOTAO} disabled={ocupado} onClick={() => voltarARascunho.mutate()}>
                Reabrir como rascunho
              </Button>
            ) : (
              <ConfirmarAcao
                grande
                titulo="Arquivar esta resposta?"
                descricao="Ela sai de uso e da fila. O histórico fica e você pode reabrir depois."
                rotuloConfirmar="Sim, arquivar"
                aoConfirmar={() => arquivarEssa.mutate()}
              >
                <Button type="button" variant="outline" className={BOTAO} disabled={ocupado}>
                  Arquivar
                </Button>
              </ConfirmarAcao>
            )}
            {rascunho ? (
              <Button type="button" variant="ghost" className={BOTAO} disabled={ocupado} onClick={aoSeguir}>
                Ver a próxima
              </Button>
            ) : null}
          </>
        )}
      </div>

      <HistoricoDaResposta id={resposta.id} versao={resposta.versao} status={resposta.status} />
    </article>
  );
}
