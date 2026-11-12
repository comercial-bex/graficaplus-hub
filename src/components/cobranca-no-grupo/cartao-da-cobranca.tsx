import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlarmClock, ExternalLink, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/bex/StatusChip";
import { Dica, DicaIcone } from "@/components/bex/Dica";
import { Carregando } from "@/components/bex/Carregando";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { useAuth } from "@/lib/auth-context";
import { dicaAcao, dicaCampo } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { diaEHora } from "@/domain/whatsapp/caixa-de-entrada";
import {
  horarioDaCobranca,
  horarioPorExtenso,
  minutosEmHoras,
  type LinhaDaConfiguracao,
  type ModoCobranca,
} from "@/domain/whatsapp/cobranca";
import { salvarCobrancaDeOrcamento } from "@/lib/api/whatsapp-caixa.functions";
import {
  MODOS,
  caminhoDaConversa,
  citadosPorExtenso,
  erroDoSabadoFim,
  erroDosMinutos,
  hhmm,
  rotuloDoModo,
  rotuloDoMotivo,
  rotuloDoNivel,
  situacaoDaCobranca,
  situacaoDaRodada,
  textoSemTelefones,
  type LinhaDaFila,
} from "@/components/cobranca-no-grupo/rotulos";

/**
 * Cartão "Cobrança de orçamento no grupo", no Monitor do WhatsApp.
 *
 * Mostra para todos que abrem o Monitor; EDITA só quem tem `configuracoes.manage` (admin e
 * gestor). Modo (Desligada, Ensaio, Ligada), os três tempos em minutos úteis com o equivalente em
 * horas, sábado sim ou não e até que hora, o horário vigente por extenso e as últimas 20
 * cobranças (no ensaio, o que teria mandado), com quem foi citado e o motivo.
 *
 * A escrita passa por `salvarCobrancaDeOrcamento` (whatsapp-caixa.functions.ts), que confere a
 * permissão e chama `whatsapp_cobranca_salvar`, só do service_role.
 *
 * Regras do dono, que enxerga mal: texto principal de 16 px, nada abaixo de 13 px, botões de
 * 44 px, ajuda pela Dica (nunca pelo atributo de título do navegador), vírgula decimal, sem
 * travessão nem seta. Falha de consulta aparece como falha, nunca como lista vazia.
 */

const ROTA = "/whatsapp-monitor";

const COLUNAS_DA_CONFIGURACAO =
  "horario_inicio, horario_fim, dias_semana, grupo_equipe_id, grupo_equipe_ativo, cobranca_modo, cobranca_min_pedido, cobranca_min_orcamento, cobranca_min_gestor, cobranca_sabado, cobranca_sabado_fim, cobranca_ligada_em, cobranca_ensaio_desde, cobranca_rodada_em, cobranca_rodada_ok, cobranca_rodada_erro";

const COLUNAS_DA_COBRANCA =
  "id, atendimento_id, conversa_id, nivel, modo, motivo, minutos_uteis, citados, texto, fila_id, agrupada, created_at";

export const CHAVES_DA_COBRANCA = {
  configuracao: ["wa-cobranca-configuracao"] as const,
  lista: ["wa-cobranca-lista"] as const,
};

type CobrancaGravada = {
  id: string;
  atendimento_id: string;
  conversa_id: string;
  nivel: number;
  modo: string;
  motivo: string;
  minutos_uteis: number;
  citados: unknown;
  texto: string;
  fila_id: string | null;
  agrupada: boolean;
  created_at: string;
};

type Formulario = {
  modo: ModoCobranca;
  min_pedido: string;
  min_orcamento: string;
  min_gestor: string;
  sabado: boolean;
  sabado_fim: string;
};

function modoValido(m: string): ModoCobranca {
  return m === "ensaio" || m === "ligada" ? m : "desligada";
}

function formularioDa(linha: LinhaDaConfiguracao): Formulario {
  return {
    modo: modoValido(linha.cobranca_modo),
    min_pedido: String(linha.cobranca_min_pedido),
    min_orcamento: String(linha.cobranca_min_orcamento),
    min_gestor: String(linha.cobranca_min_gestor),
    sabado: linha.cobranca_sabado,
    sabado_fim: hhmm(linha.cobranca_sabado_fim),
  };
}

const grupoPronto = (linha: LinhaDaConfiguracao) =>
  linha.grupo_equipe_ativo && /^\d{10,}-group$/.test(linha.grupo_equipe_id ?? "");

function useConfiguracaoDaCobranca() {
  return useQuery({
    queryKey: CHAVES_DA_COBRANCA.configuracao,
    // a última rodada muda a cada 5 minutos: o cartão acompanha sem recarregar a tela
    refetchInterval: 60_000,
    queryFn: async (): Promise<LinhaDaConfiguracao> => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_configuracoes")
        .select(COLUNAS_DA_CONFIGURACAO)
        .maybeSingle();
      if (error) throw error;
      // Sem a linha não há o que mostrar: dizer que faltou, nunca inventar "desligada".
      if (!data) throw new Error("A configuração do WhatsApp não foi encontrada.");
      return data as LinhaDaConfiguracao;
    },
  });
}

function useUltimasCobrancas(habilitada: boolean) {
  return useQuery({
    queryKey: CHAVES_DA_COBRANCA.lista,
    enabled: habilitada,
    queryFn: async (): Promise<{ cobrancas: CobrancaGravada[]; fila: Record<string, LinhaDaFila> }> => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_cobrancas")
        .select(COLUNAS_DA_COBRANCA)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const cobrancas = (data ?? []) as CobrancaGravada[];
      const ids = [...new Set(cobrancas.map((c) => c.fila_id).filter((x): x is string => !!x))];
      const fila: Record<string, LinhaDaFila> = {};
      if (ids.length > 0) {
        const r = await (supabase as any)
          .from("notificacoes_fila")
          .select("id, status, entregue_em, lido_em")
          .in("id", ids);
        if (r.error) throw r.error;
        for (const l of (r.data ?? []) as (LinhaDaFila & { id: string })[]) fila[l.id] = l;
      }
      return { cobrancas, fila };
    },
  });
}

export function CartaoDaCobranca() {
  const { hasPermission } = useAuth();
  const podeEditar = hasPermission("configuracoes.manage");
  const config = useConfiguracaoDaCobranca();
  const lista = useUltimasCobrancas(podeEditar);
  const salvar = useServerFn(salvarCobrancaDeOrcamento);
  const qc = useQueryClient();
  const [form, setForm] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (config.data && !form) setForm(formularioDa(config.data));
  }, [config.data, form]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlarmClock className="h-5 w-5" aria-hidden /> Cobrança de orçamento no grupo
        </CardTitle>
        {config.data && (
          <StatusChip
            label={rotuloDoModo(config.data.cobranca_modo)}
            tone={
              config.data.cobranca_modo === "ligada"
                ? "lime"
                : config.data.cobranca_modo === "ensaio"
                  ? "amber"
                  : "muted"
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-5 text-base">
        <p className="text-base text-muted-foreground">
          Quando um cliente pede orçamento e ninguém manda, o grupo da equipe no WhatsApp recebe um lembrete
          citando quem cuida do atendimento. Conta só o horário útil. No máximo duas cobranças por pedido; a
          segunda chama a gerência. Nada vai ao cliente.
        </p>

        {config.isError ? (
          <FalhaDeConsulta
            titulo="Não foi possível ler a configuração da cobrança"
            erro={config.error}
            onTentarDeNovo={() => void config.refetch()}
          />
        ) : config.isPending || !form ? (
          <Carregando />
        ) : (
          <Configuracao
            linha={config.data}
            form={form}
            setForm={setForm}
            podeEditar={podeEditar}
            salvando={salvando}
            onSalvar={async () => {
              const erro =
                erroDosMinutos(form.min_pedido) ??
                erroDosMinutos(form.min_orcamento) ??
                erroDosMinutos(form.min_gestor) ??
                (form.sabado ? erroDoSabadoFim(form.sabado_fim, config.data.horario_inicio) : null);
              if (erro) {
                toast.error(erro);
                return;
              }
              setSalvando(true);
              try {
                await salvar({
                  data: {
                    modo: form.modo,
                    min_pedido: Number(form.min_pedido),
                    min_orcamento: Number(form.min_orcamento),
                    min_gestor: Number(form.min_gestor),
                    sabado: form.sabado,
                    sabado_fim: hhmm(form.sabado_fim),
                  },
                });
                toast.success("Cobrança gravada.");
                setForm(null);
                await qc.invalidateQueries({ queryKey: CHAVES_DA_COBRANCA.configuracao });
                void qc.invalidateQueries({ queryKey: CHAVES_DA_COBRANCA.lista });
              } catch (e) {
                toast.error(mensagemErro(e));
              } finally {
                setSalvando(false);
              }
            }}
          />
        )}

        <div className="space-y-2">
          <h3 className="text-base font-semibold">Últimas 20 cobranças</h3>
          {!podeEditar ? (
            <p className="rounded-md border p-4 text-base text-muted-foreground">
              Só administrador e gestor veem o histórico das cobranças.
            </p>
          ) : lista.isError ? (
            <FalhaDeConsulta
              titulo="Não foi possível ler as cobranças"
              erro={lista.error}
              onTentarDeNovo={() => void lista.refetch()}
            />
          ) : lista.isPending ? (
            <Carregando />
          ) : lista.data.cobrancas.length === 0 ? (
            <p className="rounded-md border p-4 text-base text-muted-foreground">
              Nenhuma cobrança anotada ainda. No modo Ensaio, o que teria ido ao grupo aparece aqui.
            </p>
          ) : (
            <ul className="space-y-2">
              {lista.data.cobrancas.map((c) => (
                <LinhaDaCobranca
                  key={c.id}
                  c={c}
                  fila={c.fila_id ? lista.data.fila[c.fila_id] : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Configuracao({
  linha,
  form,
  setForm,
  podeEditar,
  salvando,
  onSalvar,
}: {
  linha: LinhaDaConfiguracao;
  form: Formulario;
  setForm: (f: Formulario) => void;
  podeEditar: boolean;
  salvando: boolean;
  onSalvar: () => Promise<void>;
}) {
  const mudar = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm({ ...form, [k]: v });
  const travado = !podeEditar || salvando;
  const podeLigar = grupoPronto(linha);

  const vigente = horarioPorExtenso(horarioDaCobranca(linha));
  const sabadoFimValido = !form.sabado || !erroDoSabadoFim(form.sabado_fim, linha.horario_inicio);
  const depois = sabadoFimValido
    ? horarioPorExtenso(
        horarioDaCobranca({ ...linha, cobranca_sabado: form.sabado, cobranca_sabado_fim: form.sabado_fim }),
      )
    : vigente;

  const rodada = situacaoDaRodada(
    linha.cobranca_modo,
    linha.cobranca_rodada_em ?? null,
    linha.cobranca_rodada_ok ?? null,
    linha.cobranca_rodada_erro ?? null,
    new Date(),
    linha.cobranca_modo === "ligada" ? linha.cobranca_ligada_em : linha.cobranca_ensaio_desde,
  );

  const corte =
    linha.cobranca_modo === "ligada"
      ? linha.cobranca_ligada_em
      : linha.cobranca_modo === "ensaio"
        ? linha.cobranca_ensaio_desde
        : null;

  return (
    <div className="space-y-5">
      {rodada && (
        <p
          role={rodada.problema ? "alert" : undefined}
          className={cn(
            "rounded-md border p-3 text-base",
            rodada.problema ? "border-foreground font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {rodada.texto}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium">Modo</span>
          <DicaIcone texto={dicaCampo(ROTA, "cobranca_modo")} rotulo="Modo da cobrança" />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Modo da cobrança">
          {MODOS.map((m) => {
            const marcado = form.modo === m.valor;
            const bloqueadoPorGrupo = m.valor === "ligada" && !podeLigar && linha.cobranca_modo !== "ligada";
            return (
              <Button
                key={m.valor}
                type="button"
                variant={marcado ? "default" : "outline"}
                aria-pressed={marcado}
                disabled={travado || bloqueadoPorGrupo}
                onClick={() => mudar("modo", m.valor)}
                className="h-11 min-w-28 px-4 text-base"
              >
                {m.rotulo}
              </Button>
            );
          })}
        </div>
        <p className="text-base text-muted-foreground">{MODOS.find((m) => m.valor === form.modo)?.explica}</p>
        {!podeLigar && (
          <p className="text-base text-muted-foreground">
            Para ligar, o aviso no grupo da equipe precisa estar ligado e com o id do grupo. Enquanto isso, só o
            Ensaio funciona.
          </p>
        )}
        {corte && (
          <p className="text-base text-muted-foreground">
            Conta só os pedidos feitos depois de {diaEHora(corte)}.
          </p>
        )}
        {podeEditar && form.modo !== modoValido(linha.cobranca_modo) && form.modo !== "desligada" && (
          <p className="rounded-md border p-3 text-base">
            Ao gravar, passam a contar só os pedidos feitos a partir de agora.
            {form.modo === "ligada" ? " As cobranças vão para o grupo da equipe." : ""}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <CampoDeMinutos
          id="cobranca-min-pedido"
          rotulo="Pedido sem orçamento"
          campo="cobranca_min_pedido"
          valor={form.min_pedido}
          travado={travado}
          onMudar={(v) => mudar("min_pedido", v)}
        />
        <CampoDeMinutos
          id="cobranca-min-orcamento"
          rotulo="Orçamento criado e não enviado"
          campo="cobranca_min_orcamento"
          valor={form.min_orcamento}
          travado={travado}
          onMudar={(v) => mudar("min_orcamento", v)}
        />
        <CampoDeMinutos
          id="cobranca-min-gestor"
          rotulo="Até chamar a gerência"
          campo="cobranca_min_gestor"
          valor={form.min_gestor}
          travado={travado}
          onMudar={(v) => mudar("min_gestor", v)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium">Sábado de manhã conta?</span>
          <DicaIcone texto={dicaCampo(ROTA, "cobranca_sabado")} rotulo="Sábado" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sábado conta">
          {[
            { v: false, r: "Não" },
            { v: true, r: "Sim" },
          ].map((o) => (
            <Button
              key={o.r}
              type="button"
              variant={form.sabado === o.v ? "default" : "outline"}
              aria-pressed={form.sabado === o.v}
              disabled={travado}
              onClick={() => mudar("sabado", o.v)}
              className="h-11 min-w-20 px-4 text-base"
            >
              {o.r}
            </Button>
          ))}
          {form.sabado && (
            <div className="flex items-center gap-2">
              <Label htmlFor="cobranca-sabado-fim" className="text-base">
                até
              </Label>
              <Input
                id="cobranca-sabado-fim"
                type="time"
                value={form.sabado_fim}
                disabled={travado}
                onChange={(e) => mudar("sabado_fim", e.target.value)}
                className="h-11 w-36 text-base"
              />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border p-3 text-base">
        <p>
          <span className="font-medium">Horário útil que vale agora:</span> {vigente}.
        </p>
        {depois !== vigente && (
          <p className="text-muted-foreground">Depois de gravar: {depois}.</p>
        )}
        <p className="text-muted-foreground">Horário de Macapá. Fora dele o relógio para e nada sai.</p>
      </div>

      {podeEditar ? (
        <div className="flex justify-end">
          <Dica texto={dicaAcao(ROTA, "cobranca_salvar")}>
            <Button type="button" onClick={() => void onSalvar()} disabled={salvando} className="h-11 px-5 text-base">
              {salvando ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Save className="mr-2 h-5 w-5" aria-hidden />
              )}
              Gravar cobrança
            </Button>
          </Dica>
        </div>
      ) : (
        <p className="text-base text-muted-foreground">
          Só administrador e gestor mudam a cobrança.
        </p>
      )}
    </div>
  );
}

function CampoDeMinutos({
  id,
  rotulo,
  campo,
  valor,
  travado,
  onMudar,
}: {
  id: string;
  rotulo: string;
  campo: string;
  valor: string;
  travado: boolean;
  onMudar: (v: string) => void;
}) {
  const erro = erroDosMinutos(valor);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="text-base font-medium">
          {rotulo}
        </Label>
        <DicaIcone texto={dicaCampo(ROTA, campo)} rotulo={rotulo} />
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={30}
          max={1440}
          step={10}
          value={valor}
          disabled={travado}
          aria-invalid={!!erro}
          onChange={(e) => onMudar(e.target.value)}
          className="h-11 w-28 text-base"
        />
        <span className="text-base">min úteis</span>
      </div>
      <p className={cn("text-base", erro ? "font-medium text-foreground" : "text-muted-foreground")}>
        {erro ?? `Igual a ${minutosEmHoras(Number(valor))}.`}
      </p>
    </div>
  );
}

function LinhaDaCobranca({ c, fila }: { c: CobrancaGravada; fila: LinhaDaFila | undefined }) {
  const situacao = situacaoDaCobranca(c.modo, c.fila_id, fila);
  return (
    <li className="rounded-md border p-3 text-base">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{rotuloDoNivel(c.nivel)}</span>
        <StatusChip label={situacao.rotulo} tone={situacao.tom} />
        {c.modo === "ensaio" && <StatusChip label="Ensaio" tone="muted" />}
        {c.agrupada && <StatusChip label="Na lista agrupada" tone="muted" />}
        <span className="text-muted-foreground">{diaEHora(c.created_at)}</span>
      </div>
      <p className="mt-1">
        {rotuloDoMotivo(c.motivo)}, há {minutosEmHoras(c.minutos_uteis)} úteis.
      </p>
      <p className="text-muted-foreground">Citados: {citadosPorExtenso(c.citados)}.</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <a
          href={caminhoDaConversa(c.conversa_id)}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-md border px-3 text-base font-medium text-foreground underline-offset-4 hover:underline",
          )}
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Abrir a conversa
        </a>
        <details className="min-w-0 flex-1">
          <summary className="inline-flex h-11 cursor-pointer items-center rounded-md px-3 text-base text-foreground hover:bg-muted">
            {c.modo === "ensaio" ? "Ver o que teria mandado" : "Ver a mensagem"}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-base text-foreground">
            {textoSemTelefones(c.texto)}
          </pre>
        </details>
      </div>
    </li>
  );
}
