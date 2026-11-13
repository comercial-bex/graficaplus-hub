import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  salvarRespostaDoQuadro,
  type PainelDaTriagem,
  type RespostaDaTela,
  type RespostaParaSalvar,
} from "@/lib/api/whatsapp-triagem.functions";
import {
  EXPLICACAO_DO_CASAMENTO,
  fraseJaExisteComOutraIntencao,
  ROTULO_DA_INTENCAO,
  rotuloDoPasso,
  testarFrase,
} from "@/domain/whatsapp/triagem/tela";
import type { Intencao, RespostaDoQuadro } from "@/domain/whatsapp/triagem/tipos";
import { BOTAO, CAMPO, ErroDeGravacao, SELETOR } from "./comum";

/**
 * O quadro de respostas: as frases que o robô entende, agrupadas pelo que a
 * pessoa quis dizer. O dono acrescenta frases, nunca intenções novas. O campo de
 * teste mostra, para qualquer frase digitada, o que o sistema entende hoje.
 */

const PASSOS_DO_QUADRO = [
  "nome",
  "sobrenome",
  "primeira_vez",
  "cep",
  "telefone",
  "telefone_novo",
  "fechamento",
] as const;

const INTENCOES_EDITAVEIS = (Object.keys(ROTULO_DA_INTENCAO) as Intencao[]).filter(
  (i) => i !== "nao_sei",
);

export function QuadroDeRespostas({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  const quadro: RespostaDoQuadro[] = useMemo(
    () =>
      painel.respostas
        .filter((r) => r.ativo && r.intencao !== "nao_sei")
        .map((r) => ({
          passo: r.passo,
          intencao: r.intencao as RespostaDoQuadro["intencao"],
          frase: r.frase,
          casamento: r.casamento,
        })),
    [painel.respostas],
  );
  const porIntencao = useMemo(() => {
    const m = new Map<string, RespostaDaTela[]>();
    for (const r of painel.respostas) m.set(r.intencao, [...(m.get(r.intencao) ?? []), r]);
    return m;
  }, [painel.respostas]);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Quadro de respostas</CardTitle>
        <p className="text-base text-foreground">
          São as frases que o robô entende. Escreva do jeito que o cliente escreve, com ou sem
          acento. O sistema ignora maiúsculas, acentos e pontuação. Frases curtas só valem se forem
          a mensagem inteira.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <CampoDeTeste quadro={quadro} />
        {painel.podeEditar ? <NovaFrase respostas={painel.respostas} aoMudar={aoMudar} /> : null}
        {!painel.podeEditar ? (
          <p className="text-base text-foreground">
            Editar o quadro exige a permissão de gerenciar as configurações.
          </p>
        ) : null}
        <div className="space-y-2">
          {INTENCOES_EDITAVEIS.map((i) => {
            const linhas = porIntencao.get(i) ?? [];
            return (
              <details key={i} className="rounded-lg border border-border p-3">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-base font-semibold text-foreground">
                  <span>{ROTULO_DA_INTENCAO[i]}</span>
                  <span className="font-normal text-muted-foreground">
                    {linhas.filter((l) => l.ativo).length} frase
                    {linhas.filter((l) => l.ativo).length === 1 ? "" : "s"}
                  </span>
                </summary>
                <ul className="mt-2 space-y-2">
                  {linhas.length === 0 ? (
                    <li className="text-base text-foreground">Nenhuma frase ainda.</li>
                  ) : (
                    linhas.map((l) => (
                      <LinhaDaFrase
                        key={`${l.passo ?? ""}|${l.frase}|${l.casamento}`}
                        linha={l}
                        podeEditar={painel.podeEditar}
                        aoMudar={aoMudar}
                      />
                    ))
                  )}
                </ul>
              </details>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CampoDeTeste({ quadro }: { quadro: RespostaDoQuadro[] }) {
  const [frase, setFrase] = useState("");
  const [passo, setPasso] = useState<string>("");
  const r = frase.trim() ? testarFrase(frase, passo === "" ? null : passo, quadro) : null;
  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <Label htmlFor="teste-de-frase" className="text-base font-semibold text-foreground">
        Teste uma frase
      </Label>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Input
          id="teste-de-frase"
          className={CAMPO}
          placeholder="Escreva como o cliente escreveria"
          value={frase}
          onChange={(e) => setFrase(e.target.value.slice(0, 200))}
        />
        <select
          aria-label="Em que etapa a pessoa está"
          className={SELETOR}
          value={passo}
          onChange={(e) => setPasso(e.target.value)}
        >
          <option value="">Em qualquer etapa</option>
          {PASSOS_DO_QUADRO.map((p) => (
            <option key={p} value={p}>
              Na etapa {rotuloDoPasso(p).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {r ? (
        <p
          className={cn(
            "rounded-lg border p-3 text-base text-foreground",
            r.intencao === "nao_sei" ? "border-warning bg-warning/15" : "border-border bg-muted",
          )}
          role="status"
        >
          {r.intencao === "nao_sei"
            ? r.ambigua
              ? `O robô fica em dúvida entre: ${r.candidatas.map((c) => ROTULO_DA_INTENCAO[c]).join(" e ")}. Ele pergunta de novo.`
              : "O robô não entende esta frase. Ele pergunta de novo, e na segunda vez chama a equipe."
            : `O robô entende: ${r.rotulo}.`}
        </p>
      ) : null}
    </section>
  );
}

function useGravar(aoMudar: () => void) {
  const gravar = useServerFn(salvarRespostaDoQuadro);
  return useMutation({
    mutationFn: (data: RespostaParaSalvar) => gravar({ data }),
    onSuccess: () => aoMudar(),
  });
}

function NovaFrase({
  respostas,
  aoMudar,
}: {
  respostas: RespostaDaTela[];
  aoMudar: () => void;
}) {
  const [intencao, setIntencao] = useState<Intencao>("sim");
  const [frase, setFrase] = useState("");
  const [passo, setPasso] = useState("");
  const [casamento, setCasamento] = useState<"igual" | "comeca" | "contem">("igual");
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravar(aoMudar);
  const jaExiste = fraseJaExisteComOutraIntencao(respostas, {
    passo: passo === "" ? null : passo,
    intencao,
    frase,
    casamento,
  });
  function salvar() {
    setErro(null);
    gravar.mutate(
      {
        passo: passo === "" ? null : passo,
        intencao: intencao as never,
        frase,
        casamento,
        ativo: true,
      },
      {
        onSuccess: () => {
          toast.success("Frase salva.");
          setFrase("");
        },
        onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar a frase.")),
      },
    );
  }
  const botaoDeSalvar = (
    <Button
      type="button"
      className={BOTAO}
      disabled={!frase.trim() || gravar.isPending}
      onClick={jaExiste ? undefined : salvar}
    >
      <Plus className="h-5 w-5" aria-hidden="true" /> Salvar frase
    </Button>
  );
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold text-foreground">Juntar uma frase</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="nova-intencao" className="text-base text-foreground">
            O que a pessoa quer dizer
          </Label>
          <select
            id="nova-intencao"
            className={SELETOR}
            value={intencao}
            onChange={(e) => setIntencao(e.target.value as Intencao)}
          >
            {INTENCOES_EDITAVEIS.map((i) => (
              <option key={i} value={i}>
                {ROTULO_DA_INTENCAO[i]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="nova-frase" className="text-base text-foreground">
            A frase
          </Label>
          <Input
            id="nova-frase"
            className={CAMPO}
            value={frase}
            onChange={(e) => setFrase(e.target.value.slice(0, 120))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-passo" className="text-base text-foreground">
            Onde vale
          </Label>
          <select
            id="novo-passo"
            className={SELETOR}
            value={passo}
            onChange={(e) => setPasso(e.target.value)}
          >
            <option value="">Em qualquer etapa</option>
            {PASSOS_DO_QUADRO.map((p) => (
              <option key={p} value={p}>
                Só na etapa {rotuloDoPasso(p).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-casamento" className="text-base text-foreground">
            Como comparar
          </Label>
          <select
            id="novo-casamento"
            className={SELETOR}
            value={casamento}
            onChange={(e) => setCasamento(e.target.value as typeof casamento)}
          >
            {(Object.keys(EXPLICACAO_DO_CASAMENTO) as (keyof typeof EXPLICACAO_DO_CASAMENTO)[]).map(
              (c) => (
                <option key={c} value={c}>
                  {EXPLICACAO_DO_CASAMENTO[c]}
                </option>
              ),
            )}
          </select>
        </div>
      </div>
      <ErroDeGravacao mensagem={erro} />
      {jaExiste ? (
        <p className="text-base font-medium text-foreground" role="status">
          Essa frase já existe com outro significado: {ROTULO_DA_INTENCAO[jaExiste.intencao as Intencao]}.
          Se você salvar, ela passa a significar {ROTULO_DA_INTENCAO[intencao].toLowerCase()} e deixa
          de significar o que significava.
        </p>
      ) : null}
      {jaExiste ? (
        <ConfirmarAcao
          grande
          titulo="Essa frase já existe"
          descricao={`Hoje ela significa: ${ROTULO_DA_INTENCAO[jaExiste.intencao as Intencao]}. Se você continuar, ela passa a significar: ${ROTULO_DA_INTENCAO[intencao]}. O robô vai entender a frase do novo jeito em todas as conversas.`}
          rotuloConfirmar="Sim, trocar o significado"
          aoConfirmar={salvar}
        >
          {botaoDeSalvar}
        </ConfirmarAcao>
      ) : (
        botaoDeSalvar
      )}
    </section>
  );
}

function LinhaDaFrase({
  linha,
  podeEditar,
  aoMudar,
}: {
  linha: RespostaDaTela;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravar(aoMudar);
  return (
    <li className="space-y-1 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className={cn("text-base font-medium text-foreground", !linha.ativo && "line-through")}
          >
            {linha.frase}
          </p>
          <p className="text-base text-muted-foreground">
            {EXPLICACAO_DO_CASAMENTO[linha.casamento]}{" "}
            {linha.passo
              ? `Só na etapa ${rotuloDoPasso(linha.passo).toLowerCase()}.`
              : "Vale em qualquer etapa."}
            {linha.ativo ? "" : " Desativada."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className={BOTAO}
          disabled={!podeEditar || gravar.isPending}
          onClick={() => {
            setErro(null);
            gravar.mutate(
              {
                passo: linha.passo,
                intencao: linha.intencao as never,
                frase: linha.frase,
                casamento: linha.casamento,
                ativo: !linha.ativo,
              },
              { onError: (e) => setErro(mensagemErro(e, "Não foi possível mudar a frase.")) },
            );
          }}
        >
          {linha.ativo ? "Desativar" : "Ativar de novo"}
        </Button>
      </div>
      <ErroDeGravacao mensagem={erro} />
    </li>
  );
}
