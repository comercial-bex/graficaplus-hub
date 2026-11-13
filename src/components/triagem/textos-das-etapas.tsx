import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  salvarTextoDoPasso,
  type PainelDaTriagem,
  type PassoDaTela,
} from "@/lib/api/whatsapp-triagem.functions";
import {
  problemasExplicados,
  rotuloDoPasso,
  visualizarTexto,
} from "@/domain/whatsapp/triagem/tela";
import { AREA_DE_TEXTO, BOTAO, ErroDeGravacao } from "./comum";

/**
 * Os textos de cada etapa. O dono edita aqui o que o robô diz; o banco guarda a
 * versão. Antes de salvar a tela já mostra como a pessoa vai ler e por que um
 * texto seria recusado (valor, desconto, prazo, forma de pagamento, a palavra
 * parceiro para cliente final, travessão, seta ou parênteses).
 */
export function TextosDasEtapas({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  const clientes = painel.passos.filter((p) => p.ramo === "cliente");
  const parceiros = painel.passos.filter((p) => p.ramo === "parceiro");
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Textos de cada etapa</CardTitle>
        <p className="text-base text-foreground">
          O robô nunca fala valor, desconto, prazo nem forma de pagamento. Para o cliente final,
          nunca aparece a palavra parceiro, nem tabela. Se o texto tiver algum desses, o sistema
          recusa e explica. Os campos entre chaves, como{" "}
          <code className="rounded bg-muted px-1 text-base">{"{{primeiro_nome}}"}</code>, são
          trocados na hora do envio.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Grupo titulo="Para o cliente final" passos={clientes} painel={painel} aoMudar={aoMudar} />
        <Grupo
          titulo="Para quem quer ser parceiro"
          passos={parceiros}
          painel={painel}
          aoMudar={aoMudar}
        />
      </CardContent>
    </Card>
  );
}

function Grupo({
  titulo,
  passos,
  painel,
  aoMudar,
}: {
  titulo: string;
  passos: PassoDaTela[];
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  if (passos.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">{titulo}</h3>
      <ul className="space-y-3">
        {passos.map((p) => (
          <li key={`${p.ramo}-${p.codigo}-${p.versao}`}>
            <EditorDoPasso passo={p} podeEditar={painel.podeEditar} aoMudar={aoMudar} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditorDoPasso({
  passo,
  podeEditar,
  aoMudar,
}: {
  passo: PassoDaTela;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(passo.texto);
  const [variantes, setVariantes] = useState<string[]>(passo.variantes);
  const [repeticao, setRepeticao] = useState(passo.repeticao ?? "");
  const [ativo, setAtivo] = useState(passo.ativo);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useServerFn(salvarTextoDoPasso);
  const salvar = useMutation({
    mutationFn: () =>
      gravar({
        data: {
          codigo: passo.codigo,
          ramo: passo.ramo,
          texto,
          variantes: variantes.filter((v) => v.trim()),
          repeticao: repeticao.trim() ? repeticao : null,
          ativo,
        },
      }),
    onSuccess: (r) => {
      setErro(null);
      toast.success(r.versao ? `Texto salvo. Agora é a versão ${r.versao}.` : "Texto salvo.");
      aoMudar();
    },
    onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar o texto.")),
  });

  const problemas = useMemo(() => {
    const todos: string[] = [];
    problemasExplicados(texto, passo.ramo).forEach((p) => todos.push(`Texto principal: ${p}`));
    variantes.forEach((v, i) => {
      if (v.trim())
        problemasExplicados(v, passo.ramo).forEach((p) => todos.push(`Variante ${i + 1}: ${p}`));
    });
    if (repeticao.trim())
      problemasExplicados(repeticao, passo.ramo).forEach((p) => todos.push(`Repetição: ${p}`));
    return todos;
  }, [texto, variantes, repeticao, passo.ramo]);

  const mudou =
    texto !== passo.texto ||
    repeticao !== (passo.repeticao ?? "") ||
    ativo !== passo.ativo ||
    JSON.stringify(variantes.filter((v) => v.trim())) !== JSON.stringify(passo.variantes);
  const idBase = `${passo.ramo}-${passo.codigo}`;

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        problemas.length > 0 ? "border-destructive" : "border-border",
      )}
    >
      <button
        type="button"
        className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-left text-base text-foreground"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="font-semibold">{rotuloDoPasso(passo.codigo)}</span>
        <span className="text-base text-muted-foreground">
          Versão {passo.versao}
          {passo.ativo ? "" : ". Desativado"}
        </span>
      </button>
      {passo.ajuda_para_dono ? (
        <p className="mt-1 text-base text-muted-foreground">{passo.ajuda_para_dono}</p>
      ) : null}

      {aberto ? (
        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`${idBase}-texto`} className="text-base font-semibold text-foreground">
              Texto principal
            </Label>
            <textarea
              id={`${idBase}-texto`}
              className={AREA_DE_TEXTO}
              value={texto}
              disabled={!podeEditar}
              maxLength={2000}
              onChange={(e) => setTexto(e.target.value)}
            />
            <p className="text-base text-muted-foreground">{texto.length} de 600 letras.</p>
          </div>

          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Outras formas de escrever, até duas
            </p>
            <p className="text-base text-muted-foreground">
              O mesmo contato sempre recebe a mesma forma. Deixar em branco é permitido.
            </p>
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1">
                <Label htmlFor={`${idBase}-v${i}`} className="text-base text-foreground">
                  Forma {i + 1}
                </Label>
                <textarea
                  id={`${idBase}-v${i}`}
                  className={cn(AREA_DE_TEXTO, "min-h-20")}
                  value={variantes[i] ?? ""}
                  disabled={!podeEditar}
                  maxLength={2000}
                  onChange={(e) => {
                    const novo = [...variantes];
                    novo[i] = e.target.value;
                    setVariantes(novo);
                  }}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label
              htmlFor={`${idBase}-repeticao`}
              className="text-base font-semibold text-foreground"
            >
              Quando a pessoa não entendeu a pergunta
            </Label>
            <textarea
              id={`${idBase}-repeticao`}
              className={cn(AREA_DE_TEXTO, "min-h-20")}
              value={repeticao}
              disabled={!podeEditar}
              maxLength={2000}
              onChange={(e) => setRepeticao(e.target.value)}
            />
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-foreground">
            <input
              type="checkbox"
              className="h-6 w-6 shrink-0 cursor-pointer accent-[var(--link)]"
              checked={ativo}
              disabled={!podeEditar}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Este texto está ativo
          </label>

          <Visualizacao
            texto={texto}
            variantes={variantes}
            repeticao={repeticao}
            ramo={passo.ramo}
          />

          {problemas.length > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 p-3 text-base text-foreground"
            >
              <p className="font-semibold">Este texto não pode ser salvo.</p>
              <ul className="mt-1 list-disc space-y-1 pl-6">
                {problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ErroDeGravacao mensagem={erro} />
          <Button
            type="button"
            className={BOTAO}
            disabled={!podeEditar || !mudou || problemas.length > 0 || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-5 w-5" aria-hidden="true" />
            )}
            Salvar este texto
          </Button>
          {!podeEditar ? (
            <p className="text-base text-foreground">
              Editar os textos exige a permissão de gerenciar as configurações.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Visualizacao({
  texto,
  variantes,
  repeticao,
  ramo,
}: {
  texto: string;
  variantes: string[];
  repeticao: string;
  ramo: "cliente" | "parceiro";
}) {
  const todos = [
    { rotulo: "Texto principal", valor: texto },
    ...variantes
      .map((v, i) => ({ rotulo: `Forma ${i + 1}`, valor: v }))
      .filter((x) => x.valor.trim()),
    ...(repeticao.trim() ? [{ rotulo: "Repetição", valor: repeticao }] : []),
  ];
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-base font-semibold text-foreground">
        Como a pessoa vai ler, com dados de exemplo
      </p>
      {todos.map((t) => (
        <div key={t.rotulo}>
          <p className="text-base text-muted-foreground">{t.rotulo}</p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-base leading-relaxed text-foreground">
            {visualizarTexto(t.valor, ramo).texto}
          </p>
        </div>
      ))}
    </div>
  );
}
