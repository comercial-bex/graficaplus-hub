import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Loader2, Save, UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { diaEHora, telefoneLegivel } from "@/domain/whatsapp/caixa-de-entrada";
import { ROTULO_INTENCAO, type ConfigAssistente } from "@/domain/whatsapp/assistente";
import { SETORES, type Setor } from "@/domain/whatsapp/filas";
import {
  CHAVES,
  useConfiguracoesWhatsapp,
  useDecisoesDoAssistente,
  useEquipe,
  type DecisaoDoAssistente,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { definirFilasDaPessoa, salvarConfiguracoesWhatsapp } from "@/lib/api/whatsapp-caixa.functions";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

/**
 * O Monitor do WhatsApp, parte da caixa v3: a assistente de IA (liga/desliga,
 * horário, mensagens), as decisões dela nas últimas 24 h e as filas de cada
 * pessoa da equipe. Ligar e configurar exige whatsapp › manage; as filas, o
 * administrador; ver as decisões, quem lê o WhatsApp.
 */

const DIAS = [
  { n: 1, r: "Seg" },
  { n: 2, r: "Ter" },
  { n: 3, r: "Qua" },
  { n: 4, r: "Qui" },
  { n: 5, r: "Sex" },
  { n: 6, r: "Sáb" },
  { n: 7, r: "Dom" },
];

const hhmm = (t: string) => t.slice(0, 5);

export function ConfiguracaoDoAssistente() {
  const { hasPermission } = useAuth();
  const podeConfigurar = hasPermission("whatsapp.manage");
  const config = useConfiguracoesWhatsapp();
  const salvar = useServerFn(salvarConfiguracoesWhatsapp);
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigAssistente | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (config.data && !form) setForm(config.data);
  }, [config.data, form]);

  if (config.isError) {
    return (
      <FalhaDeConsulta
        titulo="Não foi possível ler a configuração da assistente"
        erro={config.error}
        onTentarDeNovo={() => void config.refetch()}
      />
    );
  }
  if (!form) return null;

  const mudar = <K extends keyof ConfigAssistente>(k: K, v: ConfigAssistente[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function gravar(proximo: ConfigAssistente, aviso: string) {
    setSalvando(true);
    try {
      await salvar({
        data: {
          ia_ativa: proximo.ia_ativa,
          horario_inicio: hhmm(proximo.horario_inicio),
          horario_fim: hhmm(proximo.horario_fim),
          dias_semana: proximo.dias_semana,
          mensagem_fora_horario: proximo.mensagem_fora_horario,
          assinatura: proximo.assinatura,
          endereco: proximo.endereco?.trim() || null,
          horario_texto: proximo.horario_texto?.trim() || null,
        },
      });
      toast.success(aviso);
      void qc.invalidateQueries({ queryKey: CHAVES.configuracoes });
      setForm(proximo);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" /> Assistente de IA
        </CardTitle>
        <StatusChip label={form.ia_ativa ? "Ligada" : "Desligada"} tone={form.ia_ativa ? "lime" : "muted"} />
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Responde só conversas <strong>sem responsável</strong>, com os dados do sistema (situação de
          orçamento e OS, endereço, horário) e pede o que falta para orçar. Nunca fala de preço que não está
          no sistema, de prazo, de pagamento ou de desconto: nesses casos chama a equipe e a conversa vai
          para a <strong>Fila humana</strong>. Gasta saldo de IA do Lovable a cada mensagem recebida.
        </p>
        <div className="flex items-center gap-3 rounded-md border p-3">
          <Switch
            id="ia-ativa"
            checked={form.ia_ativa}
            disabled={!podeConfigurar || salvando}
            onCheckedChange={(v) =>
              void gravar({ ...form, ia_ativa: v }, v ? "Assistente ligada." : "Assistente desligada.")
            }
          />
          <Label htmlFor="ia-ativa" className="cursor-pointer">
            {form.ia_ativa ? "Ligada — responde as conversas novas" : "Desligada — ninguém responde sozinho"}
          </Label>
        </div>
        {!podeConfigurar && (
          <p className="text-xs text-muted-foreground">Mudar a assistente exige a permissão whatsapp › manage.</p>
        )}

        <fieldset disabled={!podeConfigurar || salvando} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Horário de atendimento</Label>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={hhmm(form.horario_inicio)}
                onChange={(e) => mudar("horario_inicio", e.target.value)}
                aria-label="Início"
              />
              <span className="text-muted-foreground">até</span>
              <Input
                type="time"
                value={hhmm(form.horario_fim)}
                onChange={(e) => mudar("horario_fim", e.target.value)}
                aria-label="Fim"
              />
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {DIAS.map((d) => {
                const marcado = form.dias_semana.includes(d.n);
                return (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() =>
                      mudar(
                        "dias_semana",
                        marcado ? form.dias_semana.filter((x) => x !== d.n) : [...form.dias_semana, d.n].sort(),
                      )
                    }
                    className={cn(
                      "rounded border px-2 py-0.5 text-xs",
                      marcado ? "border-foreground/30 bg-foreground/10 font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {d.r}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">Horário de Macapá. Fora dele vai um aviso por atendimento.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-assinatura">Assinatura</Label>
            <Input
              id="ia-assinatura"
              maxLength={60}
              value={form.assinatura}
              onChange={(e) => mudar("assinatura", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Vai em negrito no começo de cada mensagem da assistente.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ia-fora">Mensagem fora do horário</Label>
            <Textarea
              id="ia-fora"
              rows={2}
              maxLength={500}
              value={form.mensagem_fora_horario}
              onChange={(e) => mudar("mensagem_fora_horario", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-endereco">Endereço da gráfica</Label>
            <Input
              id="ia-endereco"
              maxLength={300}
              placeholder="Rua, número, bairro — Macapá"
              value={form.endereco ?? ""}
              onChange={(e) => mudar("endereco", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-horario">Horário, como a assistente fala</Label>
            <Input
              id="ia-horario"
              maxLength={200}
              placeholder="Segunda a sexta, das 8h às 18h"
              value={form.horario_texto ?? ""}
              onChange={(e) => mudar("horario_texto", e.target.value)}
            />
          </div>
        </fieldset>
        {podeConfigurar && (
          <div className="flex justify-end">
            <Button onClick={() => void gravar(form, "Configuração da assistente gravada.")} disabled={salvando}>
              {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Gravar configuração
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function rotuloDaDecisao(d: DecisaoDoAssistente): { texto: string; tom: "lime" | "amber" | "magenta" | "muted" | "cyan" } {
  if (d.erro) return { texto: "falhou", tom: "magenta" };
  if (d.etapa === "resposta") return { texto: "respondeu", tom: "lime" };
  if (d.etapa === "transferencia") return { texto: "passou para a equipe", tom: "amber" };
  const portao = String(d.saida?.portao ?? "");
  if (portao && portao !== "responde") return { texto: "só classificou", tom: "muted" };
  return { texto: "classificou", tom: "cyan" };
}

export function DecisoesDoAssistente() {
  const decisoes = useDecisoesDoAssistente();
  const lista = decisoes.data ?? [];
  const tokens = lista.reduce((n, d) => n + (d.tokens_entrada ?? 0) + (d.tokens_saida ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Decisões do assistente · últimas 24 h</CardTitle>
        {lista.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {lista.length} registro(s) · {tokens.toLocaleString("pt-BR")} tokens
          </span>
        )}
      </CardHeader>
      <CardContent>
        {decisoes.isError ? (
          <FalhaDeConsulta
            titulo="Não foi possível carregar as decisões"
            erro={decisoes.error}
            onTentarDeNovo={() => void decisoes.refetch()}
          />
        ) : decisoes.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma decisão nas últimas 24 h. Com a assistente ligada, cada mensagem nova de cliente sem
            responsável aparece aqui — o que ela entendeu, o que fez e por quê.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 font-medium">Quando</th>
                  <th className="py-1.5 pr-2 font-medium">Conversa</th>
                  <th className="py-1.5 pr-2 font-medium">Intenção</th>
                  <th className="py-1.5 pr-2 font-medium">Confiança</th>
                  <th className="py-1.5 pr-2 font-medium">Ação</th>
                  <th className="py-1.5 pr-2 font-medium">Detalhe</th>
                  <th className="py-1.5 font-medium">Duração</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => {
                  const r = rotuloDaDecisao(d);
                  const s = d.saida ?? {};
                  const intencao = s.intencao ? (ROTULO_INTENCAO[String(s.intencao)] ?? String(s.intencao)) : "—";
                  const confianca = typeof s.confianca === "number" ? `${Math.round(s.confianca * 100)}%` : "—";
                  const detalhe =
                    d.erro ??
                    (d.etapa === "transferencia"
                      ? String(s.motivo ?? "")
                      : d.etapa === "resposta"
                        ? (d.entrada ?? "")
                        : String(s.resumo ?? d.entrada ?? ""));
                  return (
                    <tr key={d.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-1.5 pr-2">{diaEHora(d.created_at)}</td>
                      <td className="py-1.5 pr-2">
                        {d.conversa ? d.conversa.nome_contato || telefoneLegivel(d.conversa.telefone) : "—"}
                      </td>
                      <td className="py-1.5 pr-2">{d.etapa === "classificacao" ? intencao : ""}</td>
                      <td className="py-1.5 pr-2">{d.etapa === "classificacao" ? confianca : ""}</td>
                      <td className="py-1.5 pr-2">
                        <StatusChip label={r.texto} tone={r.tom} />
                      </td>
                      <td className="max-w-[340px] py-1.5 pr-2 text-muted-foreground">
                        <span className="line-clamp-2">{detalhe}</span>
                      </td>
                      <td className="whitespace-nowrap py-1.5">
                        {d.duracao_ms != null ? `${(d.duracao_ms / 1000).toFixed(1)} s` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** As filas (setores) de cada pessoa. Só o administrador muda. */
export function FilasDaEquipe() {
  const { roles } = useAuth();
  const ehAdmin = roles.includes("admin");
  const equipe = useEquipe();
  const definir = useServerFn(definirFilasDaPessoa);
  const qc = useQueryClient();
  const [gravando, setGravando] = useState<string | null>(null);

  if (!ehAdmin) return null;

  async function alternar(pessoaId: string, atuais: Setor[], setor: Setor) {
    const novas = atuais.includes(setor) ? atuais.filter((s) => s !== setor) : [...atuais, setor];
    setGravando(pessoaId);
    try {
      await definir({ data: { usuarioId: pessoaId, filas: novas } });
      void qc.invalidateQueries({ queryKey: ["wa-caixa-equipe"] });
      void qc.invalidateQueries({ queryKey: CHAVES.minhasFilas });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRound className="h-4 w-4" /> Filas da equipe
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Cada pessoa vê, por padrão, as conversas das filas dela na caixa de entrada (“Minhas filas”). Pode
          sempre trocar para “Todas as filas”.
        </p>
        {equipe.isError ? (
          <FalhaDeConsulta
            titulo="Não foi possível carregar a equipe"
            erro={equipe.error}
            onTentarDeNovo={() => void equipe.refetch()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 font-medium">Pessoa</th>
                  {SETORES.map((s) => (
                    <th key={s.valor} className="px-2 py-1.5 text-center font-medium">
                      {s.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(equipe.data ?? []).map((p) => {
                  const atuais = (p.filas ?? []).filter((f): f is Setor => SETORES.some((s) => s.valor === f));
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">
                        {p.nome ?? "Sem nome"}
                        {gravando === p.id && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                      </td>
                      {SETORES.map((s) => (
                        <td key={s.valor} className="px-2 py-1.5 text-center">
                          <Checkbox
                            checked={atuais.includes(s.valor)}
                            disabled={gravando === p.id}
                            onCheckedChange={() => void alternar(p.id, atuais, s.valor)}
                            aria-label={`${p.nome ?? "Pessoa"} na fila ${s.rotulo}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
