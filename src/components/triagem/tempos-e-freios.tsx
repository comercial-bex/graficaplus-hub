import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  salvarConfigDaTriagem,
  type ConfigParaSalvar,
  type PainelDaTriagem,
} from "@/lib/api/whatsapp-triagem.functions";
import {
  ERRO_DE_ATRASO,
  faixaEmTexto,
  LIMITES_DA_CONFIG,
  lerCampoDeLimite,
  type CampoDeLimite,
  type DefinicaoDeLimite,
} from "@/domain/whatsapp/triagem/limites-da-config";
import { BOTAO, CAMPO, ErroDeGravacao } from "./comum";

/**
 * Os tempos e os freios do robô. Cada campo mostra o nome, o valor de agora, a unidade e a faixa que o servidor aceita
 * (a mesma lista que o servidor usa para validar, em `limites-da-config.ts`).
 *
 *   tempos  quem tem configuracoes.manage ou whatsapp.manage edita
 *   freios  só quem tem whatsapp.manage edita; os outros veem em leitura, com o motivo escrito
 *
 * Cada bloco tem o seu Salvar e manda só o que mudou, para quem edita só tempos nunca esbarrar na regra dos freios.
 * Letra de 16 px, alvo de 44 px e só cores do tema.
 */

const VALOR_DA_CONFIG: Record<CampoDeLimite, keyof PainelDaTriagem["config"]> = {
  esperaRespostaMin: "espera_resposta_min",
  retomarAteHoras: "retomar_ate_horas",
  atrasoMinS: "atraso_min_s",
  atrasoMaxS: "atraso_max_s",
  intervaloMinimoS: "intervalo_minimo_s",
  maxMensagens: "max_mensagens",
  maxTentativasPorPasso: "max_tentativas_por_passo",
  maxNovasPorHora: "max_novas_por_hora",
  maxNovasPorDia: "max_novas_por_dia",
  freioFalhasEnvio: "freio_falhas_envio",
  freioErrosHora: "freio_erros_hora",
};

function valorAtual(painel: PainelDaTriagem, campo: CampoDeLimite): number {
  return Number(painel.config[VALOR_DA_CONFIG[campo]]);
}

/** A chave muda só quando mudam os valores do próprio bloco, para salvar um não apagar o que se digitou no outro. */
function chaveDoGrupo(painel: PainelDaTriagem, grupo: DefinicaoDeLimite["grupo"]): string {
  const valores = LIMITES_DA_CONFIG.filter((l) => l.grupo === grupo).map((l) => valorAtual(painel, l.campo));
  return `${grupo}-${valores.join("-")}`;
}

export function TemposEFreios({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  const podeTempo = painel.podeEditar || painel.podeLigar;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Tempos e freios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-base text-muted-foreground">
          Os tempos dizem quanto o robô espera e demora. Os freios param o robô sozinho quando algo
          sai do normal.
        </p>
        <GrupoDeCampos
          key={chaveDoGrupo(painel, "tempo")}
          painel={painel}
          aoMudar={aoMudar}
          grupo="tempo"
          titulo="Tempos"
          podeEditar={podeTempo}
          semPermissao="Seu perfil não pode mudar os tempos."
          botao="Salvar tempos"
          aviso="Tempos salvos."
        />
        <GrupoDeCampos
          key={chaveDoGrupo(painel, "freio")}
          painel={painel}
          aoMudar={aoMudar}
          grupo="freio"
          titulo="Freios"
          podeEditar={painel.podeLigar}
          semPermissao="Só quem pode ligar o robô muda os freios. Você pode ver os valores, mas não mudar."
          botao="Salvar freios"
          aviso="Freios salvos."
        />
      </CardContent>
    </Card>
  );
}

function GrupoDeCampos({
  painel,
  aoMudar,
  grupo,
  titulo,
  podeEditar,
  semPermissao,
  botao,
  aviso,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
  grupo: DefinicaoDeLimite["grupo"];
  titulo: string;
  podeEditar: boolean;
  semPermissao: string;
  botao: string;
  aviso: string;
}) {
  const campos = LIMITES_DA_CONFIG.filter((l) => l.grupo === grupo);
  const [texto, setTexto] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((l) => [l.campo, String(valorAtual(painel, l.campo))])),
  );
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const gravar = useServerFn(salvarConfigDaTriagem);
  const mutacao = useMutation({
    mutationFn: (data: ConfigParaSalvar) => gravar({ data }),
    onSuccess: () => aoMudar(),
  });

  // o que a pessoa digitou, campo a campo: o número ou a frase de erro
  const lidos = campos.map((l) => ({ l, r: lerCampoDeLimite(l.campo, texto[l.campo] ?? "") }));
  const mudou = lidos.filter((x) => x.r.ok && x.r.valor !== valorAtual(painel, x.l.campo));
  const invalido = lidos.some((x) => !x.r.ok);

  // o atraso mínimo e o máximo são lidos juntos, com o valor que vai ficar valendo
  const valorFinal = (campo: CampoDeLimite): number => {
    const x = lidos.find((y) => y.l.campo === campo);
    return x && x.r.ok ? x.r.valor : valorAtual(painel, campo);
  };
  const atrasoTrocado =
    grupo === "tempo" && valorFinal("atrasoMinS") > valorFinal("atrasoMaxS") ? ERRO_DE_ATRASO : null;

  function salvar() {
    setErroDoServidor(null);
    const data: Record<string, number> = {};
    for (const x of mudou) if (x.r.ok) data[x.l.campo] = x.r.valor;
    // se mexeu em um dos atrasos, manda os dois: o servidor e o banco conferem o par
    if ("atrasoMinS" in data || "atrasoMaxS" in data) {
      data.atrasoMinS = valorFinal("atrasoMinS");
      data.atrasoMaxS = valorFinal("atrasoMaxS");
    }
    mutacao.mutate(data as ConfigParaSalvar, {
      onSuccess: () => toast.success(aviso),
      onError: (e) =>
        setErroDoServidor(mensagemErro(e, "Não foi possível salvar. Confira os números e tente de novo.")),
    });
  }

  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4"
      aria-labelledby={`grupo-${grupo}`}
    >
      <h3 id={`grupo-${grupo}`} className="text-lg font-semibold text-foreground">
        {titulo}
      </h3>
      {!podeEditar ? (
        <p className="flex items-start gap-2 text-base text-foreground">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{semPermissao}</span>
        </p>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        {lidos.map(({ l, r }) => {
          const id = `limite-${l.campo}`;
          return (
            <div key={l.campo} className="space-y-1.5">
              <Label htmlFor={id} className="text-base font-semibold text-foreground">
                {l.rotulo}
              </Label>
              <p id={`${id}-ajuda`} className="text-base text-muted-foreground">
                {l.ajuda}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={id}
                  inputMode="numeric"
                  className={cn(CAMPO, "w-28")}
                  value={texto[l.campo] ?? ""}
                  readOnly={!podeEditar}
                  aria-invalid={!r.ok}
                  aria-describedby={`${id}-ajuda ${id}-faixa${podeEditar && !r.ok ? ` ${id}-erro` : ""}`}
                  onChange={(e) =>
                    setTexto((t) => ({ ...t, [l.campo]: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                  }
                />
                <span className="text-base text-foreground">{l.unidade}</span>
              </div>
              <p id={`${id}-faixa`} className="text-base text-muted-foreground">
                Valor agora: {valorAtual(painel, l.campo)}. {faixaEmTexto(l)}
              </p>
              {podeEditar && !r.ok ? (
                <p id={`${id}-erro`} role="alert" className="text-base font-medium text-destructive">
                  {r.erro}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {podeEditar && atrasoTrocado ? (
        <p role="alert" className="text-base font-medium text-destructive">
          {atrasoTrocado}
        </p>
      ) : null}
      {podeEditar ? (
        <div className="space-y-2">
          <Button
            type="button"
            className={cn(BOTAO, "min-w-44")}
            disabled={mudou.length === 0 || invalido || !!atrasoTrocado || mutacao.isPending}
            onClick={salvar}
          >
            {mutacao.isPending ? "Salvando..." : botao}
          </Button>
          <ErroDeGravacao mensagem={erroDoServidor} />
        </div>
      ) : null}
    </section>
  );
}
