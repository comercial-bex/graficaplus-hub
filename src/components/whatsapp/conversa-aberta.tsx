import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import {
  ANEXO_TIPOS,
  desfechoDoEnvio,
  nomeDaConversa,
  podeResponder,
  quandoFoi,
  validarAnexo,
  type ConversaDaCaixa,
  type Desfecho,
  type Liberacao,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import { mapaDeRotulos, mapaDeSetores } from "@/domain/whatsapp/equipe";
import { assinaturaDaPessoa } from "@/domain/whatsapp/assinatura";
import {
  CHAVES,
  acionarEnvio,
  enfileirarResposta,
  mapaDeNomes,
  subirAnexo,
  useAtendimentos,
  useConfiguracoesWhatsapp,
  useEquipe,
  useEventosDaConversa,
  useFotosDosContatos,
  useMensagensPaginadas,
  useNaoLidasPorMim,
  useTempoRealDaConversa,
  type InstanciaDaCaixa,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import {
  CHAVE_METRICAS_DA_TRIAGEM,
  CHAVE_TRIAGENS_DA_CAIXA,
} from "@/components/whatsapp/usar-triagens-da-caixa";
import { chaveDoRascunho, lerRascunho, gravarRascunho } from "@/components/whatsapp/rascunhos";
import {
  andarNaBusca,
  ocorrenciasDaBusca,
  resumoDaBusca,
} from "@/domain/whatsapp/busca-na-conversa";
import { montarLinhaDoTempo, type ItemCru } from "@/domain/whatsapp/linha-do-tempo";
import { fotosDaConversa, legendaDaBolha } from "@/domain/whatsapp/midia";
import { precisaConfirmarBarra } from "@/domain/whatsapp/teclado";
import type { ModoDaCaixa } from "@/domain/whatsapp/moldura";
import { oQueDaPraFazer, type DialogoDaConversa } from "@/domain/whatsapp/acoes-de-trabalho";
import {
  acaoNaConversa,
  enfileirarArquivo,
  marcarLidaPorMim,
  type AcaoNaConversa,
} from "@/lib/api/whatsapp-caixa.functions";
import { atendidoPermitido, infoDoSetor, type MotivoResolucao } from "@/domain/whatsapp/filas";
import {
  DialogoAtalhos,
  DialogoResolver,
  DialogoTransferir,
  FaixaDoModo,
} from "@/components/whatsapp/acoes-da-conversa";
import {
  BarraDeBuscaNaConversa,
  CabecalhoDaConversa,
} from "@/components/whatsapp/cabecalho-da-conversa";
import {
  CaixaDeResposta,
  type OpcoesDoEnvio,
} from "@/components/whatsapp/caixa-de-resposta";
import { LinhaDoTempo, type ControleDaLinha } from "@/components/whatsapp/linha-do-tempo";

function avisar(d: Desfecho) {
  if (d.tom === "sucesso") toast.success(d.texto);
  else if (d.tom === "erro") toast.error(d.texto);
  else toast.warning(d.texto);
}

/**
 * O que a moldura (whatsapp.tsx) passa à conversa. Contrato da onda 1
 * (12/11/2026): MOLDURA passa, CONVERSA usa. Nesta etapa final as quatro props
 * novas são obrigatórias e `painelAberto`, `onAlternarPainel` e `acoes` foram
 * apagadas (o painel virou a gaveta da moldura).
 */
export type PropsDaConversaAberta = {
  conversa: ConversaDaCaixa;
  instancia: InstanciaDaCaixa | null;
  conexaoComFalha: boolean;
  temPermissaoDeResponder: boolean;
  /** Volta à lista: o botão Voltar de 44 px do modo estreito. (O Esc é da moldura.) */
  onVoltar: () => void;
  /** Aberta pela Nova conversa: o cursor já vai para a resposta. */
  focarResposta?: boolean;
  className?: string;
  /** O modo da área: no estreito aparece o Voltar e o Orçamento vai para o menu de três pontos. */
  modo: ModoDaCaixa;
  /** Abre ou fecha os dados do contato (clique no nome ou na foto; "Dados do contato" no menu). */
  onAlternarDados: () => void;
  /** Os dados do contato estão abertos (aria-expanded do nome). */
  dadosAbertos: boolean;
  /** Abre um diálogo de trabalho (orçamento, OS, vincular cliente); quem desenha é a gaveta. */
  onAbrirDialogo: (d: DialogoDaConversa) => void;
};

/**
 * A conversa aberta no jeito do WhatsApp (onda 1, 12/11/2026): cabeçalho de uma
 * linha, linha do tempo com as cores --chat-*, caixa de resposta que cresce.
 * Este arquivo é o orquestrador: consultas, ações, envio e o estado que liga os
 * pedaços. O desenho está em cabecalho-da-conversa.tsx, linha-do-tempo.tsx,
 * bolha-da-mensagem.tsx e caixa-de-resposta.tsx.
 *
 * O texto da caixa NÃO é estado daqui: mora em rascunhos.ts, por conversa. Assim
 * cada tecla não renderiza as centenas de bolhas, e trocar de conversa não
 * perde o que se começou a escrever.
 */
export function ConversaAberta({
  conversa,
  instancia,
  conexaoComFalha,
  temPermissaoDeResponder,
  onVoltar,
  focarResposta = false,
  className,
  modo: modoDaCaixa,
  onAlternarDados,
  dadosAbertos,
  onAbrirDialogo,
}: PropsDaConversaAberta) {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const meuId = user?.id ?? null;
  const acao = useServerFn(acaoNaConversa);
  const enviarArquivo = useServerFn(enfileirarArquivo);
  const marcarLida = useServerFn(marcarLidaPorMim);
  const mensagens = useMensagensPaginadas(conversa.id);
  const eventos = useEventosDaConversa(conversa.id);
  const equipe = useEquipe();
  const config = useConfiguracoesWhatsapp();
  const atendimentos = useAtendimentos(conversa.id);
  const naoLidasPorMim = useNaoLidasPorMim();
  useTempoRealDaConversa(conversa.id);
  const [transferirAberto, setTransferirAberto] = useState(false);
  const [resolverAberto, setResolverAberto] = useState(false);
  const [atalhosAberto, setAtalhosAberto] = useState(false);

  // Volta no modo nota se havia nota por escrever: o texto dela não pode cair na caixa do cliente.
  const [modo, setModo] = useState<"mensagem" | "nota">(() =>
    lerRascunho(chaveDoRascunho(conversa.id, true)).trim() ? "nota" : "mensagem",
  );
  const [enviando, setEnviando] = useState(false);
  const [tentando, setTentando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const controleDaLinha = useRef<ControleDaLinha | null>(null);
  // Aberta pela Nova conversa: o cursor vai para a resposta quando o diálogo
  // já fechou (o `autoFocus` na montagem perdia para o foco preso do diálogo).
  const respostaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focarResposta && temPermissaoDeResponder) respostaRef.current?.focus();
  }, [focarResposta, temPermissaoDeResponder]);

  // Busca dentro da conversa (a lupa do cabeçalho).
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [atual, setAtual] = useState(-1);

  const nomes = useMemo(() => mapaDeNomes(equipe.data), [equipe.data]);
  const rotulos = useMemo(() => mapaDeRotulos(equipe.data), [equipe.data]);
  const setoresDaEquipe = useMemo(() => mapaDeSetores(equipe.data), [equipe.data]);
  const liberacao: Liberacao =
    conexaoComFalha && temPermissaoDeResponder
      ? {
          liberado: false,
          rotulo: "Não foi possível conferir a conexão do WhatsApp",
          motivo:
            "A leitura da conexão falhou (o erro está no topo da tela). Recarregue antes de responder.",
        }
      : podeResponder(instancia, temPermissaoDeResponder);
  const nome = nomeDaConversa(conversa);
  const fotosDoContato = useFotosDosContatos([conversa.foto_path]);
  // A assinatura de quem está olhando, como o despachante vai montar (o aviso
  // de transferência sai com ela).
  const eu = (equipe.data ?? []).find((p) => p.id === user?.id) ?? null;
  const minhaAssinatura = eu ? assinaturaDaPessoa({ nome: eu.nome, papeis: eu.papeis, fila: conversa.fila }) : null;
  // "assumida por Yvens · Gerência": quem está com a conversa e de que setor.
  const responsavel = conversa.responsavel_id
    ? `assumida por ${rotulos.get(conversa.responsavel_id) ?? "Equipe"}`
    : null;

  // O que dá para fazer além de responder; sem permissão o item continua à
  // vista, desabilitado e com o motivo (contrato, 3.3).
  const disponivel = oQueDaPraFazer({
    podeResponder: temPermissaoDeResponder,
    podeOrcar: hasPermission("orcamentos.create"),
    podeAbrirOs: hasPermission("os.create"),
    clienteId: conversa.cliente_id ?? null,
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    void qc.invalidateQueries({ queryKey: ["wa-caixa-eventos", conversa.id] });
    // Responder ou assumir pausa o robô de boas-vindas: o selo e as métricas dele mudam na hora, não em um minuto.
    void qc.invalidateQueries({ queryKey: CHAVE_TRIAGENS_DA_CAIXA });
    void qc.invalidateQueries({ queryKey: CHAVE_METRICAS_DA_TRIAGEM });
  };

  // O divisor "Mensagens não lidas": `marcarLidaPorMim` zera o contador ao
  // abrir, então o número é guardado ANTES da primeira marcação (senão o
  // divisor nasce e some no mesmo instante). A leitura é a de quem olha
  // (`nao_lidas` da conversa é de todos). Como a consulta pode ainda não ter
  // chegado, a marcação espera por ela (ou pela falha dela).
  const naoLidasNaAbertura = useRef<number | null>(null);
  if (naoLidasNaAbertura.current === null && (naoLidasPorMim.isSuccess || naoLidasPorMim.isError)) {
    naoLidasNaAbertura.current = naoLidasPorMim.data?.get(conversa.id) ?? 0;
  }
  const naoLidasAoAbrir = naoLidasNaAbertura.current ?? 0;
  const sabeOsNaoLidas = naoLidasNaAbertura.current !== null;

  // Abrir marca como lida PARA QUEM ABRIU (cada um tem a sua leitura) e, para
  // quem responde, zera o contador geral, como antes. De novo quando chega
  // mensagem com a conversa aberta.
  const qtdMensagens = (mensagens.data?.pages ?? []).reduce((n, p) => n + p.length, 0);
  useEffect(() => {
    if (!sabeOsNaoLidas) return;
    marcarLida({ data: { conversaId: conversa.id } })
      .then(() => qc.invalidateQueries({ queryKey: CHAVES.naoLidas }))
      .then(() => {
        if ((conversa.nao_lidas ?? 0) > 0) void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      })
      .catch((e: unknown) => toast.error(`Não foi possível marcar como lida: ${mensagemErro(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id, qtdMensagens, sabeOsNaoLidas]);

  const mensagensCarregadas = useMemo(
    () => (mensagens.data?.pages ?? []).flat(),
    [mensagens.data],
  );
  const fotos = useMemo(() => fotosDaConversa(mensagensCarregadas), [mensagensCarregadas]);

  const itens = useMemo(() => {
    const maisAntiga = mensagensCarregadas.length
      ? mensagensCarregadas[mensagensCarregadas.length - 1].created_at
      : null;
    const crus: ItemCru[] = mensagensCarregadas.map((m) => ({ tipo: "msg", quando: quandoFoi(m), m }));
    for (const e of eventos.data ?? []) {
      // Eventos mais antigos que a mensagem mais antiga carregada esperam o
      // "mensagens anteriores"; senão apareceriam soltos no topo.
      if (mensagens.hasNextPage && maisAntiga && e.created_at < maisAntiga) continue;
      crus.push({ tipo: "evento", quando: e.created_at, e });
    }
    return montarLinhaDoTempo(crus, { naoLidas: naoLidasAoAbrir });
  }, [mensagensCarregadas, eventos.data, mensagens.hasNextPage, naoLidasAoAbrir]);

  // A busca acha entre as mensagens carregadas (as anteriores entram com "Mensagens anteriores").
  const ocorrencias = useMemo(
    () =>
      buscaAberta
        ? ocorrenciasDaBusca(
            mensagensCarregadas
              .slice()
              .sort((a, b) => quandoFoi(a).localeCompare(quandoFoi(b)))
              .map((m) => ({ id: m.id, texto: legendaDaBolha(m) })),
            termo,
          )
        : [],
    [buscaAberta, mensagensCarregadas, termo],
  );
  // A busca começa na ocorrência mais nova, como no WhatsApp.
  useEffect(() => {
    setAtual(ocorrencias.length ? ocorrencias.length - 1 : -1);
  }, [ocorrencias.length, termo]);
  const termoAtivo = buscaAberta && termo.trim() ? termo : null;
  const ocorrenciaAtualId = termoAtivo ? (ocorrencias[atual] ?? null) : null;

  function fecharBusca() {
    setBuscaAberta(false);
    setTermo("");
    setAtual(-1);
  }

  async function executar(dados: AcaoNaConversa, sucesso: string): Promise<boolean> {
    setOcupado(true);
    try {
      await acao({ data: dados });
      toast.success(sucesso);
      recarregar();
      void qc.invalidateQueries({ queryKey: CHAVES.atendimentos(conversa.id) });
      return true;
    } catch (e) {
      toast.error(mensagemErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Transferência com aviso opcional ao cliente (14/10/2026). O banco faz as
   * duas coisas numa transação; aqui só se aciona o envio na hora (o job de
   * 2 min leva de qualquer jeito) e se diz o que aconteceu com o aviso.
   */
  async function transferir(dados: AcaoNaConversa, sucesso: string): Promise<boolean> {
    setOcupado(true);
    try {
      const r = await acao({ data: dados });
      if (r.aviso?.enfileirado) {
        toast.success(`${sucesso}. O aviso ao cliente está saindo.`);
        void acionarEnvio();
      } else if (r.aviso) {
        toast.warning(`${sucesso}, mas o aviso ao cliente não saiu: ${r.aviso.motivo ?? "motivo não informado"}.`);
      } else {
        toast.success(sucesso);
      }
      recarregar();
      void qc.invalidateQueries({ queryKey: CHAVES.atendimentos(conversa.id) });
      return true;
    } catch (e) {
      toast.error(mensagemErro(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function apagarRascunho() {
    gravarRascunho(chaveDoRascunho(conversa.id, modo === "nota"), "");
  }

  /**
   * Envia o que está na caixa (nota interna ou mensagem). Texto que começa com
   * "/" no modo mensagem só sai com `confirmouBarra`: a caixa pergunta antes e
   * esta guarda fica por segurança, porque no laboratório de 11/11 o "/pix"
   * foi ao cliente literal.
   */
  async function enviar(opcoes?: OpcoesDoEnvio) {
    const limpo = lerRascunho(chaveDoRascunho(conversa.id, modo === "nota")).trim();
    if (!limpo || enviando) return;
    if (modo === "nota") {
      setEnviando(true);
      try {
        await acao({ data: { acao: "nota", conversaId: conversa.id, texto: limpo } });
        apagarRascunho();
        setModo("mensagem");
        controleDaLinha.current?.irParaOFim();
        recarregar();
      } catch (e) {
        toast.error(mensagemErro(e));
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (precisaConfirmarBarra(limpo) && !opcoes?.confirmouBarra) return;
    if (!liberacao.liberado) return;
    setEnviando(true);
    try {
      let enfileirada: { mensagem_id: string; fila_id: string };
      try {
        enfileirada = await enfileirarResposta(conversa.id, limpo);
      } catch (e) {
        toast.error(mensagemErro(e));
        return;
      }
      apagarRascunho();
      controleDaLinha.current?.irParaOFim();
      recarregar();
      const http = await acionarEnvio();
      avisar(desfechoDoEnvio(http, enfileirada.fila_id, enfileirada.mensagem_id));
      recarregar();
    } finally {
      setEnviando(false);
    }
  }

  async function anexar(arquivo: File) {
    const erro = validarAnexo(arquivo);
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      const caminho = await subirAnexo(conversa.id, arquivo, arquivo.name);
      const r = await enviarArquivo({
        data: {
          conversaId: conversa.id,
          tipo: ANEXO_TIPOS[arquivo.type],
          caminho,
          nomeArquivo: arquivo.name,
          legenda: lerRascunho(conversa.id).trim() || undefined,
        },
      });
      apagarRascunho();
      controleDaLinha.current?.irParaOFim();
      recarregar();
      const http = await acionarEnvio();
      avisar(desfechoDoEnvio(http, r.fila_id, r.mensagem_id));
      recarregar();
    } catch (e) {
      toast.error(`O arquivo não foi enviado: ${mensagemErro(e)}`);
    } finally {
      setEnviando(false);
    }
  }

  async function tentarDeNovo(m: MensagemDaCaixa) {
    setTentando(true);
    try {
      const http = await acionarEnvio();
      const atualizado = await mensagens.refetch();
      const depois = (atualizado.data?.pages ?? []).flat().find((x) => x.id === m.id);
      if (
        depois?.status === "enviada" ||
        depois?.status === "entregue" ||
        depois?.status === "lida"
      ) {
        toast.success("Mensagem enviada.");
      } else if (depois?.status === "falha") {
        toast.error(`A mensagem não saiu: ${depois.erro ?? "o Z-API recusou"}.`);
      } else {
        const motivo =
          depois?.erro ??
          ("falhaDeRede" in http
            ? http.falhaDeRede
            : (http.corpo?.erro ?? "o envio vai ser tentado de novo"));
        toast.warning(`Ainda na fila: ${motivo}.`);
      }
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    } finally {
      setTentando(false);
    }
  }

  // As bolhas são memorizadas: estas funções precisam manter a identidade entre
  // renders, senão a lista inteira redesenha a cada mensagem nova.
  const tentarDeNovoRef = useRef(tentarDeNovo);
  tentarDeNovoRef.current = tentarDeNovo;
  const aoTentarDeNovo = useCallback((m: MensagemDaCaixa) => void tentarDeNovoRef.current(m), []);
  const aoReescrever = useCallback(
    (texto: string) => {
      gravarRascunho(conversa.id, texto);
      setModo("mensagem");
      setTimeout(() => respostaRef.current?.focus(), 0);
    },
    [conversa.id],
  );
  const aoArquivar = useCallback(
    () => void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) }),
    [qc, conversa.id],
  );

  const resolver = (motivo: MotivoResolucao, nota?: string) =>
    executar({ acao: "resolver", conversaId: conversa.id, motivo, nota }, "Atendimento resolvido");

  const aberta = conversa.status === "aberta" || conversa.status === "pendente";
  const atendimentoAtual = (atendimentos.data ?? []).find((a) => !a.fechado_em) ?? null;
  const podeAtendido = atendidoPermitido(mensagensCarregadas);

  return (
    <Card className={cn("@container/conversa flex min-h-0 flex-col overflow-hidden", className)}>
      <CabecalhoDaConversa
        conversa={conversa}
        nome={nome}
        fotoUrl={conversa.foto_path ? fotosDoContato.data?.get(conversa.foto_path) : null}
        responsavel={responsavel}
        modo={modoDaCaixa}
        dadosAbertos={dadosAbertos}
        temPermissaoDeResponder={temPermissaoDeResponder}
        meuId={meuId}
        ocupado={ocupado}
        iaLigada={config.data?.ia_ativa === true}
        disponivel={disponivel}
        buscaAberta={buscaAberta}
        onVoltar={onVoltar}
        onAlternarDados={onAlternarDados}
        onAbrirDialogo={onAbrirDialogo}
        onAssumir={() =>
          void executar({ acao: "assumir", conversaId: conversa.id }, "Você assumiu o atendimento")
        }
        onTransferir={() => setTransferirAberto(true)}
        onResolver={() => setResolverAberto(true)}
        onStatus={(status, rotulo) =>
          void executar({ acao: "status", conversaId: conversa.id, status }, rotulo)
        }
        onDevolver={() =>
          void executar({ acao: "devolver_ia", conversaId: conversa.id }, "Conversa devolvida à assistente")
        }
        onAtalhos={() => setAtalhosAberto(true)}
        onAlternarBusca={() => (buscaAberta ? fecharBusca() : setBuscaAberta(true))}
      />

      {buscaAberta && (
        <BarraDeBuscaNaConversa
          termo={termo}
          onTermo={setTermo}
          resumo={resumoDaBusca(atual, ocorrencias.length, termo)}
          temOcorrencias={ocorrencias.length > 0}
          onAnterior={() => setAtual((a) => andarNaBusca(a, ocorrencias.length, -1))}
          onProxima={() => setAtual((a) => andarNaBusca(a, ocorrencias.length, 1))}
          onFechar={fecharBusca}
        />
      )}

      <FaixaDoModo
        iaLigada={config.data?.ia_ativa === true}
        modo={conversa.modo}
        temResponsavel={!!conversa.responsavel_id}
        aberta={aberta}
        podeDevolver={temPermissaoDeResponder}
        ocupado={ocupado}
        onDevolver={() =>
          void executar({ acao: "devolver_ia", conversaId: conversa.id }, "Conversa devolvida à assistente")
        }
      />

      {temPermissaoDeResponder && (
        <>
          <DialogoTransferir
            aberto={transferirAberto}
            onAberto={setTransferirAberto}
            equipe={equipe.data ?? []}
            responsavelAtual={conversa.responsavel_id}
            filaAtual={conversa.fila}
            ocupado={ocupado}
            assinatura={minhaAssinatura}
            onPessoa={(para, aviso) =>
              transferir(
                { acao: "transferir", conversaId: conversa.id, para, aviso: aviso ?? undefined },
                "Conversa transferida",
              )
            }
            onFila={(fila, motivo, aviso) =>
              transferir(
                { acao: "transferir_fila", conversaId: conversa.id, fila, motivo, aviso: aviso ?? undefined },
                `Conversa passada para a fila ${infoDoSetor(fila).rotulo}`,
              )
            }
          />
          <DialogoResolver
            aberto={resolverAberto}
            onAberto={setResolverAberto}
            atendidoPermitido={podeAtendido}
            numeroDoAtendimento={atendimentoAtual?.numero ?? null}
            ocupado={ocupado}
            onResolver={resolver}
          />
        </>
      )}
      <DialogoAtalhos aberto={atalhosAberto} onAberto={setAtalhosAberto} />

      <LinhaDoTempo
        conversaId={conversa.id}
        itens={itens}
        carregando={mensagens.isPending}
        erro={mensagens.isError ? mensagens.error : null}
        onTentarCarregarDeNovo={() => void mensagens.refetch()}
        temAnteriores={!!mensagens.hasNextPage}
        carregandoAnteriores={mensagens.isFetchingNextPage}
        onCarregarAnteriores={() => void mensagens.fetchNextPage()}
        nomes={nomes}
        setoresDaEquipe={setoresDaEquipe}
        meuId={meuId}
        podeResponder={temPermissaoDeResponder}
        liberado={liberacao.liberado}
        tentando={tentando}
        fotos={fotos}
        realce={termoAtivo}
        ocorrenciaAtualId={ocorrenciaAtualId}
        aoArquivar={aoArquivar}
        onTentarDeNovo={aoTentarDeNovo}
        onReescrever={aoReescrever}
        controle={controleDaLinha}
      />

      <CaixaDeResposta
        conversaId={conversa.id}
        modo={modo}
        onModo={setModo}
        enviando={enviando}
        temPermissaoDeResponder={temPermissaoDeResponder}
        liberacao={liberacao}
        disponivel={disponivel}
        onAbrirDialogo={onAbrirDialogo}
        onEnviar={(opcoes) => void enviar(opcoes)}
        onAnexar={(arquivo) => void anexar(arquivo)}
        respostaRef={respostaRef}
      />
    </Card>
  );
}
