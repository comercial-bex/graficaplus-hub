import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  lerMetricasDoAgente,
  type MetricasDoAgenteDaTela,
} from "@/lib/api/agente-escolhe.functions";
import {
  agenteSemDados,
  MODOS_DE_METRICA,
  motivosDaAcao,
  resumirCobertura,
  semRespostaPorDia,
  usoDasRespostas,
  type ListaDeMotivos,
  type ModoDeMetrica,
  type ResumoDaCobertura,
} from "@/domain/agente/metricas";
import { motivoDoRastroEmTexto } from "@/domain/agente/simular";
import {
  diaCurto,
  percentualEmTexto,
  plural,
  concorda,
  type Taxa,
} from "@/domain/whatsapp/triagem/metricas";
import { Aviso, ErroDaTela } from "@/components/triagem/comum";

/** A chave da leitura das métricas do agente: invalidar atualiza a tela. */
export const CHAVE_METRICAS_DO_AGENTE = ["agente-metricas"] as const;

/**
 * Métricas do agente, só leitura, últimos 30 dias. Cada número diz de quantos ele é: percentual solto engana. Três estados
 * distintos, nunca misturados: carregando, ERRO ("não consegui carregar", com botão) e zerado ("sem dados ainda", que é uma
 * resposta honesta e não uma falha). De verdade e ensaio ficam em blocos separados e nunca se somam: ensaio é o que o agente
 * faria, e nada saiu. Nenhum texto de mensagem chega aqui: a frase do contato sem resposta não é guardada, só a contagem.
 */
export function MetricasDoAgente() {
  const ler = useServerFn(lerMetricasDoAgente);
  const q = useQuery({
    queryKey: CHAVE_METRICAS_DO_AGENTE,
    queryFn: () => ler(),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Como o agente está indo</CardTitle>
        <p className="text-base text-foreground">
          Últimos 30 dias. As respostas de verdade e as do ensaio aparecem separadas, porque o
          ensaio só anota o que o agente faria e não manda nada. Aqui só há contagens: a frase do
          cliente que ficou sem resposta não é guardada.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 text-base">
        {q.isLoading ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Carregando as métricas
          </p>
        ) : q.error || !q.data ? (
          <ErroDaTela
            erro={q.error}
            aoTentar={() => q.refetch()}
            titulo="Não consegui carregar as métricas do agente"
          />
        ) : (
          <Conteudo dados={q.data} />
        )}
      </CardContent>
    </Card>
  );
}

function Conteudo({ dados }: { dados: MetricasDoAgenteDaTela }) {
  if (agenteSemDados(dados.dias, dados.hoje)) {
    return (
      <Aviso>
        <p className="font-semibold">Sem dados ainda.</p>
        <p className="mt-1">
          O agente não decidiu nenhuma pergunta nos últimos 30 dias, nem de verdade nem em ensaio.
          Isso é esperado enquanto ele está desligado. Os números aparecem aqui quando ele passar
          para o ensaio e uma conversa liberada pela triagem receber uma pergunta.
        </p>
      </Aviso>
    );
  }
  const uso = usoDasRespostas(dados.respostas, dados.base, "real");
  return (
    <>
      {MODOS_DE_METRICA.map((modo) => (
        <BlocoDoModo key={modo} modo={modo} dados={dados} />
      ))}
      <NuncaUsadas uso={uso} />
    </>
  );
}

function BlocoDoModo({ modo, dados }: { modo: ModoDeMetrica; dados: MetricasDoAgenteDaTela }) {
  const resumo = resumirCobertura(dados.dias, modo, dados.hoje);
  const titulo = modo === "real" ? "Respostas de verdade" : "Ensaio: o que o agente faria";
  if (resumo.decisoes === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">{titulo}</h3>
        <Aviso>
          <p className="font-semibold">Sem dados ainda.</p>
          <p className="mt-1">
            {modo === "real"
              ? "O agente ainda não respondeu nem entregou nenhuma conversa de verdade nos últimos 30 dias."
              : "O agente ainda não anotou nenhuma decisão em ensaio nos últimos 30 dias."}
          </p>
        </Aviso>
      </section>
    );
  }
  const motivosEntrega = motivosDaAcao(dados.motivos, modo, ["entregar"]);
  const motivosSilencio = motivosDaAcao(dados.motivos, modo, ["barrar", "parar"]);
  const uso = usoDasRespostas(dados.respostas, dados.base, modo);
  const dias = semRespostaPorDia(dados.semResposta, dados.dias, modo, dados.hoje);
  return (
    <section className="space-y-4" aria-label={titulo}>
      <h3 className="text-lg font-semibold">{titulo}</h3>
      <p>
        <span className="font-semibold">{resumo.perguntas}</span>{" "}
        {concorda(resumo.perguntas, "pergunta lida", "perguntas lidas")}
        {modo === "real" ? " e respondidas ou entregues" : " e anotadas"}, mais{" "}
        {plural(resumo.barradas, "mensagem em silêncio", "mensagens em silêncio")}, como cumprimento
        ou pedido para parar.
      </p>
      <Cartoes resumo={resumo} modo={modo} />
      <ListaDeMotivosNaTela
        titulo="Por que o agente passou a conversa para a equipe"
        vazio="Nenhuma conversa foi passada para a equipe."
        lista={motivosEntrega}
        base="das conversas passadas para a equipe"
      />
      <ListaDeMotivosNaTela
        titulo="Por que o agente ficou em silêncio"
        vazio="O agente não ficou em silêncio nenhuma vez."
        lista={motivosSilencio}
        base="das vezes em que ficou em silêncio"
      />
      <MaisUsadas uso={uso} modo={modo} />
      <SemResposta dias={dias} />
    </section>
  );
}

function Cartoes({ resumo, modo }: { resumo: ResumoDaCobertura; modo: ModoDeMetrica }) {
  const quem = modo === "real" ? "" : " em ensaio";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Cartao
        titulo={`Cobertura${quem}`}
        valor={resumo.escolhidas}
        taxa={resumo.cobertura}
        base="das perguntas tiveram uma resposta aprovada"
      />
      <Cartao
        titulo={`Voltou para a equipe${quem}`}
        valor={resumo.entregues}
        taxa={resumo.voltaParaEquipe}
        base="das perguntas foram passadas para a equipe"
      />
      <Cartao
        titulo={`Perguntaram preço${quem}`}
        valor={resumo.sensiveis}
        taxa={resumo.deValor}
        base="das perguntas. O agente nunca diz valor, só que a equipe confirma"
      />
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  taxa,
  base,
}: {
  titulo: string;
  valor: number;
  taxa: Taxa;
  base: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="font-semibold">{titulo}</h4>
      <p className="mt-1 text-2xl font-bold">
        {taxa.percentual === null ? "Sem base ainda" : percentualEmTexto(taxa)}
      </p>
      <p className="mt-1">
        {taxa.percentual === null
          ? `Nenhuma pergunta na base de comparação: ${base}.`
          : `${valor} de ${taxa.denominador}, ${base}.`}
      </p>
    </div>
  );
}

function ListaDeMotivosNaTela({
  titulo,
  vazio,
  lista,
  base,
}: {
  titulo: string;
  vazio: string;
  lista: ListaDeMotivos;
  base: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="font-semibold">{titulo}</h4>
      {lista.itens.length === 0 ? (
        <p className="mt-1">{vazio}</p>
      ) : (
        <>
          <p className="mt-1">
            Total: {lista.total}. Cada linha diz quantas, {base}.
          </p>
          {lista.itens.some((i) => i.motivo === "passou_com_a_resposta") ? (
            <p className="mt-1">
              O total inclui as conversas em que o agente respondeu antes de passar para a equipe.
              Por isso ele pode ser maior que o número do cartão Voltou para a equipe, que só conta
              as que o agente passou sem responder.
            </p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {lista.itens.map((i) => (
              <li key={i.motivo}>
                <span className="font-semibold">
                  {i.n} de {lista.total}, {percentualEmTexto(i.parte)}:
                </span>{" "}
                {motivoDoRastroEmTexto(i.motivo)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MaisUsadas({
  uso,
  modo,
}: {
  uso: ReturnType<typeof usoDasRespostas>;
  modo: ModoDeMetrica;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="font-semibold">Respostas mais usadas nos últimos 30 dias</h4>
      {uso.maisUsadas.length === 0 ? (
        <p className="mt-1">
          Nenhuma resposta aprovada foi {modo === "real" ? "escolhida" : "escolhida em ensaio"} nos
          últimos 30 dias.
        </p>
      ) : (
        <ol className="mt-2 space-y-1">
          {uso.maisUsadas.map((r) => (
            <li key={r.resposta_id}>
              <span className="font-semibold">
                {modo === "real" ? r.usos_real_30_dias : r.usos_ensaio_30_dias}{" "}
                {(modo === "real" ? r.usos_real_30_dias : r.usos_ensaio_30_dias) === 1
                  ? "vez"
                  : "vezes"}
                :
              </span>{" "}
              {r.pergunta}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NuncaUsadas({ uso }: { uso: ReturnType<typeof usoDasRespostas> }) {
  return (
    <section className="space-y-2" aria-label="Respostas nunca usadas">
      <h3 className="text-lg font-semibold">Respostas aprovadas que nunca foram usadas</h3>
      {uso.aprovadas === 0 ? (
        <Aviso>Nenhuma resposta está aprovada ainda.</Aviso>
      ) : uso.nuncaUsadas.length === 0 ? (
        <Aviso>
          Todas as {uso.aprovadas} respostas aprovadas já foram usadas, de verdade ou em ensaio.
        </Aviso>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <p>
            <span className="font-semibold">
              {uso.nuncaUsadas.length} de {uso.aprovadas}, {percentualEmTexto(uso.nuncaUsadasTaxa)}
            </span>{" "}
            das respostas aprovadas nunca foram usadas, de verdade nem em ensaio, nos registros que
            o sistema guarda. Pode ser uma resposta que ninguém pergunta, ou uma frase gatilho que
            não casa com o que o cliente escreve.
          </p>
          <ul className="mt-2 space-y-1">
            {uso.nuncaUsadas.map((r) => (
              <li key={r.resposta_id}>{r.pergunta}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SemResposta({ dias }: { dias: ReturnType<typeof semRespostaPorDia> }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="font-semibold">Perguntas sem resposta aprovada, por dia</h4>
      {dias.length === 0 ? (
        <p className="mt-1">Nenhuma pergunta ficou sem resposta nos últimos 30 dias.</p>
      ) : (
        <>
          <p className="mt-1">
            Só a contagem: a frase do cliente não é guardada. Cada número que aparece aqui é uma
            resposta que talvez falte escrever.
          </p>
          <ul className="mt-2 space-y-1">
            {dias.map((d) => (
              <li key={d.dia}>
                <span className="font-semibold">{diaCurto(d.dia)}:</span> {d.semResposta} de{" "}
                {plural(d.perguntas, "pergunta", "perguntas")}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
