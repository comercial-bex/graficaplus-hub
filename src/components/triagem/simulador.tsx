import { useMemo, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PainelDaTriagem } from "@/lib/api/whatsapp-triagem.functions";
import { digitarComoRobo, type SessaoSimulada } from "@/domain/whatsapp/triagem/simular";
import {
  novaSimulacao,
  OPCOES_PADRAO_DO_SIMULADOR,
  ROTULO_DA_INTENCAO,
  rotuloDoPasso,
  type DadosDoSimulador,
  type OpcoesDoSimulador,
} from "@/domain/whatsapp/triagem/tela";
import type { Intencao } from "@/domain/whatsapp/triagem/tipos";
import { Aviso, BOTAO, CAMPO } from "./comum";

/**
 * O simulador: uma conversa de mentira com o motor do robô. Roda no navegador,
 * na função pura, com os textos e o quadro que estão salvos. NÃO envia nada, não
 * grava nada e não chama o servidor: não existe caminho daqui até o WhatsApp.
 */
export function Simulador({ painel }: { painel: PainelDaTriagem }) {
  const dados: DadosDoSimulador = useMemo(
    () => ({
      passos: painel.passos.map((p) => ({ ...p, variantes: p.variantes })),
      respostas: painel.respostas,
      horarios: painel.horarios,
      feriados: painel.feriados,
      config: painel.config,
    }),
    [painel],
  );
  const [opcoes, setOpcoes] = useState<OpcoesDoSimulador>(OPCOES_PADRAO_DO_SIMULADOR);
  const [sessao, setSessao] = useState<SessaoSimulada>(() =>
    novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR),
  );
  const [texto, setTexto] = useState("");

  function recomecar(novas: OpcoesDoSimulador = opcoes) {
    setSessao(novaSimulacao(dados, novas));
    setTexto("");
  }

  function mudarOpcao(novas: OpcoesDoSimulador) {
    setOpcoes(novas);
    recomecar(novas);
  }

  function mandar(t: string | null, tipo: "texto" | "audio" | "figurinha" | "imagem" = "texto") {
    if (tipo === "texto" && !(t ?? "").trim()) return;
    setSessao((s) => digitarComoRobo(s, t, { tipo }).sessao);
    setTexto("");
  }

  const linkVazio = !(painel.config.link_parceiro ?? "").trim();
  const ultimo = sessao.resultados[sessao.resultados.length - 1];
  const entendida = ultimo?.eventos.find((e) => e.tipo === "interpretada")?.intencao as
    | Intencao
    | null
    | undefined;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Simulador</CardTitle>
        <p className="text-base text-foreground">
          Converse com o robô de mentira. Nada é enviado a ninguém e nada é gravado. Ele usa os
          textos e o quadro que estão salvos nesta tela e responde depois de cada mensagem sua, como
          faria no WhatsApp. Se você mudar um texto, aperte Recomeçar para usar a versão nova.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="grid gap-3 md:grid-cols-3">
          <legend className="mb-1 text-base font-semibold text-foreground">Como é o contato</legend>
          <Opcao
            id="sim-horario"
            rotulo="A loja está"
            valor={opcoes.horario}
            opcoes={[
              ["dentro", "Aberta, segunda às 10h"],
              ["fora", "Fechada, sábado às 20h"],
            ]}
            aoMudar={(v) => mudarOpcao({ ...opcoes, horario: v as OpcoesDoSimulador["horario"] })}
          />
          <Opcao
            id="sim-anuncio"
            rotulo="Veio de"
            valor={opcoes.anuncioDeParceiro ? "parceiro" : "comum"}
            opcoes={[
              ["comum", "Anúncio comum ou sem anúncio"],
              ["parceiro", "Anúncio de parceiro"],
            ]}
            aoMudar={(v) => mudarOpcao({ ...opcoes, anuncioDeParceiro: v === "parceiro" })}
          />
          <Opcao
            id="sim-numero"
            rotulo="Número do chat"
            valor={opcoes.numeroDoChatEstranho ? "estranho" : "normal"}
            opcoes={[
              ["normal", "Celular comum"],
              ["estranho", "Identificador longo, sem celular"],
            ]}
            aoMudar={(v) => mudarOpcao({ ...opcoes, numeroDoChatEstranho: v === "estranho" })}
          />
        </fieldset>

        {opcoes.numeroDoChatEstranho ? (
          <Aviso tom="atencao">
            Com esse número o robô de verdade não escreve. Ele ainda não sabe responder a quem
            aparece só por identificador longo do WhatsApp: entrega a conversa à equipe, sem
            nenhuma mensagem, e deixa o aviso no grupo.
          </Aviso>
        ) : null}
        {linkVazio && (opcoes.anuncioDeParceiro || sessao.estado.ramo === "parceiro") ? (
          <Aviso tom="atencao">
            O link de cadastro de parceiro está vazio. Sem ele o robô de verdade não manda link:
            passa a conversa para a equipe, sem cadastro. É isso que este simulador mostra agora.
            Preencha o link no painel Ligar e desligar para ver a mensagem com o link.
          </Aviso>
        ) : null}

        <div
          className="max-h-[28rem] min-h-40 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted p-3"
          role="log"
          aria-live="polite"
          aria-label="Conversa simulada"
        >
          {sessao.conversa.length === 0 ? (
            <p className="text-base text-foreground">
              Nenhuma mensagem ainda. Escreva a primeira, como o cliente escreveria.
            </p>
          ) : (
            sessao.conversa.map((f, i) => (
              <p
                key={i}
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-base leading-relaxed text-foreground",
                  f.de === "contato" ? "ml-auto border-border bg-card" : "border-link bg-link/10",
                )}
              >
                <span className="block text-base font-semibold">
                  {f.de === "contato" ? "Cliente" : "Robô"}
                </span>
                {f.texto}
              </p>
            ))
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mandar(texto);
          }}
        >
          <label htmlFor="sim-texto" className="sr-only">
            Mensagem do cliente
          </label>
          <Input
            id="sim-texto"
            className={cn(CAMPO, "min-w-0 flex-1 sm:min-w-72")}
            placeholder="Escreva a mensagem do cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, 500))}
          />
          <Button type="submit" className={BOTAO} disabled={!texto.trim()}>
            <Send className="h-5 w-5" aria-hidden="true" /> Mandar
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className={BOTAO}
            onClick={() => mandar(null, "audio")}
          >
            Mandar um áudio
          </Button>
          <Button
            type="button"
            variant="outline"
            className={BOTAO}
            onClick={() => mandar(null, "figurinha")}
          >
            Mandar uma figurinha
          </Button>
          <Button
            type="button"
            variant="outline"
            className={BOTAO}
            onClick={() => mandar(null, "imagem")}
          >
            Mandar uma foto
          </Button>
          <Button type="button" variant="outline" className={BOTAO} onClick={() => recomecar()}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Recomeçar
          </Button>
        </div>

        <div
          className="rounded-lg border border-border p-3 text-base text-foreground"
          role="status"
        >
          <p>
            <strong>Etapa agora:</strong>{" "}
            {sessao.estado.passo ? rotuloDoPasso(sessao.estado.passo) : "ainda não começou"}.{" "}
            <strong>Situação:</strong> {situacaoEmTexto(sessao.estado.status)}.{" "}
            <strong>Mensagens do robô:</strong> {sessao.estado.mensagensEnviadas}.
          </p>
          {entendida ? (
            <p className="mt-1">
              <strong>O robô entendeu a sua última mensagem como:</strong>{" "}
              {ROTULO_DA_INTENCAO[entendida]}.
            </p>
          ) : null}
          {ultimo?.avisarGrupo ? (
            <p className="mt-1">
              <strong>Aviso ao grupo da equipe:</strong> sairia agora, por este motivo:{" "}
              {ultimo.avisarGrupo.motivo.replace(/_/g, " ")}.
            </p>
          ) : null}
          {ultimo?.bloquearContato ? (
            <p className="mt-1">
              <strong>Pediu para parar:</strong> o contato entraria na lista de quem não recebe mais
              mensagem.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function situacaoEmTexto(status: string): string {
  const m: Record<string, string> = {
    ativa: "em andamento",
    ensaio: "em andamento",
    concluida: "terminou",
    expirada: "ficou sem resposta",
    pausada_humano: "a equipe assumiu",
    pausada_desligada: "parada",
    parada_pelo_contato: "o contato pediu para parar",
    entregue_equipe: "entregue à equipe",
    pulada: "pulada",
  };
  return m[status] ?? status;
}

function Opcao({
  id,
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  valor: string;
  opcoes: [string, string][];
  aoMudar: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-base text-foreground">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
      >
        {opcoes.map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}
