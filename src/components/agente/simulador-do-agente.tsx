import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PainelDoAgente } from "@/lib/api/agente-escolhe.functions";
import type { RamoDaBase } from "@/domain/agente-base/tipos";
import { coberturaDaBase, ramoDoAgenteEmTexto, RAMOS_DO_AGENTE } from "@/domain/agente/painel";
import { baseQueServe, simularAgente, type ResultadoDaSimulacao } from "@/domain/agente/simular";
import { compilarTermosDoBanco } from "@/domain/whatsapp/triagem/verificador";
import { Aviso, BOTAO, CAMPO, SELETOR } from "@/components/triagem/comum";

/**
 * O simulador do agente: o dono digita uma pergunta, escolhe o ramo e vê qual resposta aprovada o agente escolheria, ou por
 * que entregaria à equipe. Roda no navegador, na mesma função de decisão do servidor, com a base e o quadro que estão salvos.
 * NÃO envia nada, não grava nada e não chama o servidor: a frase digitada nunca sai desta tela.
 */
export function SimuladorDoAgente({ painel }: { painel: PainelDoAgente }) {
  const [ramo, setRamo] = useState<RamoDaBase>("cliente");
  const [jaPerguntouPreco, setJaPerguntouPreco] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<ResultadoDaSimulacao | null>(null);
  const [perguntada, setPerguntada] = useState<string | null>(null);

  const termos = useMemo(() => compilarTermosDoBanco(painel.termos).regras, [painel.termos]);
  const aprovadas = useMemo(() => baseQueServe(painel.base), [painel.base]);
  const cobertura = useMemo(() => coberturaDaBase(painel.base), [painel.base]);
  const doRamo = cobertura.porRamo.find((c) => c.ramo === ramo);

  // a base, o quadro ou os termos recarregaram: o resultado na tela foi calculado com a base velha e não vale mais
  useEffect(() => {
    setResultado(null);
    setPerguntada(null);
  }, [painel.base, painel.quadro, painel.termos]);

  function simular() {
    const pergunta = texto.trim();
    if (!pergunta) return;
    setPerguntada(pergunta);
    setResultado(
      simularAgente({ pergunta, ramo, jaPerguntouPreco }, painel.base, painel.quadro, termos),
    );
  }

  function recomecar() {
    setTexto("");
    setResultado(null);
    setPerguntada(null);
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Simulador</CardTitle>
        <p className="text-base text-foreground">
          Escreva uma pergunta como o cliente escreveria e veja o que o agente faria. Nada é enviado
          a ninguém e nada é gravado: a sua pergunta fica só nesta tela. O simulador responde como
          se o agente estivesse ligado, com as respostas aprovadas de hoje. Se você aprovar outra
          resposta, recarregue a tela para usar a base nova.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="grid gap-3 md:grid-cols-2">
          <legend className="mb-1 text-base font-semibold text-foreground">
            Como é a conversa
          </legend>
          <div className="space-y-1">
            <label htmlFor="sim-agente-ramo" className="text-base text-foreground">
              O contato é
            </label>
            <select
              id="sim-agente-ramo"
              className={SELETOR}
              value={ramo}
              onChange={(e) => {
                setRamo(e.target.value as RamoDaBase);
                setResultado(null);
              }}
            >
              {RAMOS_DO_AGENTE.map((r) => (
                <option key={r} value={r}>
                  {ramoDoAgenteEmTexto(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="sim-agente-preco" className="text-base text-foreground">
              Perguntou preço antes nesta conversa
            </label>
            <select
              id="sim-agente-preco"
              className={SELETOR}
              value={jaPerguntouPreco ? "sim" : "nao"}
              onChange={(e) => {
                setJaPerguntouPreco(e.target.value === "sim");
                setResultado(null);
              }}
            >
              <option value="nao">Não, é a primeira pergunta de preço</option>
              <option value="sim">Sim, já perguntou uma vez</option>
            </select>
          </div>
        </fieldset>

        {aprovadas.length === 0 ? (
          <Aviso tom="atencao">
            Nenhuma resposta está aprovada. O simulador vai mostrar que o agente entrega toda
            pergunta à equipe. Aprove respostas na tela Respostas do agente.
          </Aviso>
        ) : doRamo && doRamo.aprovadas === 0 ? (
          <Aviso tom="atencao">
            {ramoDoAgenteEmTexto(ramo)} não tem nenhuma resposta aprovada. O agente entregaria toda
            pergunta deste ramo à equipe.
          </Aviso>
        ) : null}

        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            simular();
          }}
        >
          <label htmlFor="sim-agente-texto" className="sr-only">
            Pergunta do cliente
          </label>
          <Input
            id="sim-agente-texto"
            className={cn(CAMPO, "min-w-0 flex-1 sm:min-w-72")}
            placeholder="Escreva a pergunta do cliente"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value.slice(0, 500));
              setResultado(null);
            }}
          />
          <Button type="submit" className={BOTAO} disabled={!texto.trim()}>
            <Send className="h-5 w-5" aria-hidden="true" /> Ver o que o agente faria
          </Button>
          <Button type="button" variant="outline" className={BOTAO} onClick={recomecar}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Limpar
          </Button>
        </form>

        <div role="status" aria-live="polite" className="space-y-3">
          {resultado ? (
            <Resultado resultado={resultado} pergunta={perguntada ?? ""} />
          ) : (
            <p className="text-base text-foreground">Nenhuma pergunta simulada ainda.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const TOM_DO_DESFECHO: Record<ResultadoDaSimulacao["desfecho"], string> = {
  responderia: "border-success bg-success/15",
  entregaria: "border-warning bg-warning/15",
  silencio: "border-border bg-muted",
  pararia: "border-border bg-muted",
  nada: "border-border bg-muted",
};

function Resultado({ resultado, pergunta }: { resultado: ResultadoDaSimulacao; pergunta: string }) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4 text-base text-foreground",
        TOM_DO_DESFECHO[resultado.desfecho],
      )}
    >
      <p className="font-semibold">{resultado.titulo}</p>
      <p>
        <strong>Pergunta simulada:</strong> {pergunta}
      </p>
      <p>{resultado.explicacao}</p>
      {resultado.resposta ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p>
            <strong>Resposta escolhida:</strong>{" "}
            {resultado.resposta.perguntaDaBase || resultado.resposta.tema}
          </p>
          <p className="whitespace-pre-wrap">
            <strong>O contato receberia, palavra por palavra:</strong>
          </p>
          <p className="whitespace-pre-wrap rounded-md border border-link bg-link/10 p-3 leading-relaxed">
            {resultado.resposta.texto}
          </p>
          {resultado.resposta.passaParaEquipe ? (
            <p>Depois de mandar esta resposta, o agente passa a conversa para a equipe.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
