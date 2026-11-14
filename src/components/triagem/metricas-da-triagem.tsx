import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lerMetricasDaTriagem, type MetricasDaTriagem } from "@/lib/api/whatsapp-triagem.functions";
import {
  diaCurto,
  duracaoEmTexto,
  estaZerado,
  concorda,
  linhasDaTabela,
  mediaDoDia,
  outrosDoDia,
  percentualEmTexto,
  plural,
  ramoEmTexto,
  resumirJanela,
  type LinhaDoDia,
  type Taxa,
} from "@/domain/whatsapp/triagem/metricas";
import { CHAVE_METRICAS_DA_TRIAGEM } from "@/components/whatsapp/usar-triagens-da-caixa";
import { Aviso, ErroDaTela } from "./comum";

const DIAS_NA_TABELA = 14;
const ROTULO_OUTROS = "Outros: em andamento, robô desligado ou contato pediu para parar";

/**
 * Métricas do robô de boas-vindas, só leitura, últimos 30 dias. Cada número diz
 * de quantos ele é: percentual solto engana. Três estados distintos, nunca
 * misturados: carregando, ERRO ("não consegui carregar", com botão) e zerado
 * ("sem dados ainda", que é uma resposta honesta e não uma falha). Simulação e
 * conversa que o portão deixou de fora não entram na conta.
 */
export function MetricasDaTriagem() {
  const ler = useServerFn(lerMetricasDaTriagem);
  const q = useQuery({ queryKey: CHAVE_METRICAS_DA_TRIAGEM, queryFn: () => ler(), staleTime: 30_000 });

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Como o robô está indo</CardTitle>
        <p className="text-base text-foreground">
          Últimos 30 dias, só conversas de verdade. A simulação desta tela não entra, nem as conversas que
          o robô deixou de fora, como cliente cadastrado ou quem a equipe já atendeu.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 text-base">
        {q.isLoading ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Carregando as métricas
          </p>
        ) : q.error || !q.data ? (
          <ErroDaTela
            erro={q.error}
            aoTentar={() => q.refetch()}
            titulo="Não consegui carregar as métricas"
          />
        ) : (
          <Conteudo dados={q.data} />
        )}
      </CardContent>
    </Card>
  );
}

function Conteudo({ dados }: { dados: MetricasDaTriagem }) {
  const resumo = resumirJanela(dados.janela);
  if (estaZerado(resumo)) {
    return (
      <Aviso>
        <p className="font-semibold">Sem dados ainda.</p>
        <p className="mt-1">
          Nenhuma conversa passou pela triagem de verdade nos últimos 30 dias. Isso é esperado enquanto o
          robô está desligado ou só em ensaio. Os números aparecem aqui quando a primeira conversa real
          for triada.
        </p>
        {resumo.puladas > 0 ? (
          <p className="mt-1">
            {plural(resumo.puladas, "conversa foi deixada", "conversas foram deixadas")} de fora pelo robô no
            período, e por isso {concorda(resumo.puladas, "não conta", "não contam")}.
          </p>
        ) : null}
      </Aviso>
    );
  }

  const linhas = linhasDaTabela(dados.dias, DIAS_NA_TABELA);

  return (
    <>
      <p className="text-base">
        <span className="font-semibold">{resumo.triadas}</span>{" "}
        {concorda(resumo.triadas, "conversa triada", "conversas triadas")} nos últimos 30 dias.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Cartao titulo="Concluídas" valor={resumo.concluidas} taxa={resumo.concluidas_taxa} base="das triadas" />
        <Cartao
          titulo="Entregues à equipe"
          valor={resumo.entregues_equipe}
          taxa={resumo.entregues_taxa}
          base="das triadas"
        />
        <Cartao
          titulo="Sem resposta do contato"
          valor={resumo.abandonadas}
          taxa={resumo.abandonadas_taxa}
          base="das triadas"
        />
        <Cartao
          titulo="Responderam ao nome"
          valor={resumo.resposta_ao_nome.numerador}
          taxa={resumo.resposta_ao_nome}
          base="de quem recebeu a primeira mensagem do robô"
        />
        <Cartao
          titulo="Perguntaram preço"
          valor={resumo.pediu_preco.numerador}
          taxa={resumo.pediu_preco}
          base="das triadas. O robô nunca responde valor"
        />
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold">Equipe assumiu e o robô parou</h3>
          <p className="mt-1 text-2xl font-bold">{resumo.triagens_com_pausa_humano}</p>
          <p className="mt-1">
            Em {plural(resumo.triagens_com_pausa_humano, "conversa triada", "conversas triadas")} nos últimos 30
            dias a equipe assumiu e o robô parou, mesmo quando o robô retomou depois. Cada conversa conta uma vez.
          </p>
          <p className="mt-1">
            Agora, {plural(resumo.pausadas_humano, "conversa segue pausada", "conversas seguem pausadas")} pela
            equipe, entre as triadas nos últimos 30 dias.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold">Outros</h3>
          <p className="mt-1 text-2xl font-bold">{resumo.outros}</p>
          <p className="mt-1">
            {ROTULO_OUTROS}. Junto com concluídas, entregues, sem resposta e pausadas pela equipe, fecha o total de
            triadas.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold">Tempo até concluir</h3>
        <p className="mt-1">Mediana, só das conversas concluídas.</p>
        <ul className="mt-2 space-y-1">
          {resumo.medianaPorRamo.map((m) => (
            <li key={m.ramo}>
              {ramoEmTexto(m.ramo)}: <span className="font-semibold">{duracaoEmTexto(m.segundos)}</span>
              {m.amostra > 0
                ? `, de ${plural(m.amostra, "conversa concluída", "conversas concluídas")}`
                : ""}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold">Por dia, nos últimos {DIAS_NA_TABELA} dias com conversa triada</h3>

        <ul className="mt-2 space-y-3 md:hidden" aria-label="Conversas triadas por dia e por tipo de contato">
          {linhas.map((l) => (
            <li key={`${l.dia}-${l.ramo}`} className="rounded-lg border border-border bg-card p-4">
              <p className="font-semibold">
                {diaCurto(l.dia)}, {ramoEmTexto(l.ramo)}
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {camposDoDia(l).map(([nome, valor]) => (
                  <div key={nome} className="contents">
                    <dt>{nome}</dt>
                    <dd className="text-right font-semibold">{valor}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <div className="mt-2 hidden rounded-lg border border-border md:block">
          <table className="w-full table-fixed text-left text-base">
            <caption className="sr-only">Conversas triadas por dia e por tipo de contato</caption>
            <thead className="bg-muted text-foreground">
              <tr>
                <th scope="col" className="p-2">Dia</th>
                <th scope="col" className="p-2">Tipo</th>
                {CABECALHOS_DO_DIA.map((c) => (
                  <th key={c} scope="col" className="p-2">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={`${l.dia}-${l.ramo}`} className="border-t border-border align-top">
                  <td className="p-2">{diaCurto(l.dia)}</td>
                  <td className="p-2">{ramoEmTexto(l.ramo)}</td>
                  {camposDoDia(l).map(([nome, valor]) => (
                    <td key={nome} className="p-2">{valor}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const CABECALHOS_DO_DIA = [
  "Triadas",
  "Concluídas",
  "Entregues à equipe",
  "Sem resposta",
  "Pausadas pela equipe",
  "Outros",
  "Tempo médio",
] as const;

/** Os mesmos campos, na mesma ordem, para o cartão do celular e para a tabela. */
function camposDoDia(l: LinhaDoDia): [string, string | number][] {
  return [
    [CABECALHOS_DO_DIA[0], l.triadas],
    [CABECALHOS_DO_DIA[1], l.concluidas],
    [CABECALHOS_DO_DIA[2], l.entregues_equipe],
    [CABECALHOS_DO_DIA[3], l.abandonadas],
    [CABECALHOS_DO_DIA[4], l.pausadas_humano],
    [CABECALHOS_DO_DIA[5], outrosDoDia(l)],
    [CABECALHOS_DO_DIA[6], duracaoEmTexto(mediaDoDia(l))],
  ];
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
      <h3 className="font-semibold">{titulo}</h3>
      <p className="mt-1 text-2xl font-bold">
        {taxa.percentual === null ? "Sem base ainda" : percentualEmTexto(taxa)}
      </p>
      <p className="mt-1">
        {taxa.percentual === null
          ? `Ninguém na base de comparação: ${base}.`
          : `${valor} de ${taxa.denominador}, ${base}.`}
      </p>
    </div>
  );
}
