import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Factory, Plus, Pencil, Zap, Gauge, Timer } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";
import { useAuth } from "@/lib/auth-context";
import { ParametrosDeMaquina } from "@/components/maquinas/parametros-de-maquina";

export const Route = createFileRoute("/_authenticated/maquinas")({
  head: () => ({
    meta: [
      { title: "Máquinas e hora-máquina — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Cadastro de equipamentos com custo por hora, potência, setup e velocidade para o cálculo real de produção.",
      },
      { property: "og:title", content: "Máquinas e hora-máquina — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Custo por hora, potência e capacidade de cada equipamento da gráfica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MaquinasPage,
});

type Form = {
  id?: string;
  nome: string;
  tipo: string;
  setor: string;
  custo_hora: string;
  potencia_kw: string;
  setup_min: string;
  velocidade_m2_h: string;
  disponibilidade_pct: string;
  fabricante: string;
  modelo: string;
  numero_serie: string;
  largura_util_m: string;
  avanco_m: string;
};

const emptyForm: Form = {
  nome: "",
  tipo: "",
  setor: "",
  custo_hora: "0",
  potencia_kw: "0",
  setup_min: "0",
  velocidade_m2_h: "0",
  disponibilidade_pct: "100",
  fabricante: "",
  modelo: "",
  numero_serie: "",
  largura_util_m: "",
  avanco_m: "",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function MaquinasPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("*")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  /**
   * Contratos das máquinas — bloco separado de propósito.
   *
   * `maquinas` é lida por toda a equipe (`is_staff`), então valor de parcela e
   * total financiado não podem morar lá. Ficam em `maquinas_contrato`, com RLS
   * de `financeiro.read`: quem não pode ver dinheiro recebe zero linhas e a
   * tela simplesmente não mostra o bloco.
   */
  const { data: contratos = [] } = useQuery({
    queryKey: ["maquinas-contrato"],
    enabled: canSeeFinancials,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_contrato")
        .select("*");
      return (data ?? []) as Record<string, any>[];
    },
  });
  const contratoPorMaquina = new Map(contratos.map((c) => [c.maquina_id as string, c]));

  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null);

  /**
   * Custo/hora sugerido pelo contrato.
   *
   * As 5 máquinas estavam com custo/hora zero, e zero aqui não é "de graça": é
   * a hora de máquina e a energia saindo do orçamento sem entrar no preço.
   * Pedir para alguém digitar não resolve — ninguém sabe de cabeça quanto custa
   * a hora de uma impressora.
   *
   * O contrato sabe. Locação divide a parcela pelas horas do mês; compra dilui
   * o valor pela vida útil. A função devolve a conta junto, porque número de
   * custo sem a memória de cálculo ao lado ninguém confere — e este vai para
   * dentro do preço de venda.
   */
  const { data: sugestoes = {} } = useQuery({
    queryKey: ["custo-hora-sugerido", maquinas.map((m) => m.id).join(",")],
    enabled: maquinas.length > 0,
    queryFn: async () => {
      const mapa: Record<string, any> = {};
      for (const m of maquinas) {
        const { data } = await (supabase.rpc as any)("custo_hora_sugerido", { p_maquina_id: m.id });
        if (data) mapa[m.id] = data;
      }
      return mapa;
    },
  });

  const aplicarCusto = useMutation({
    mutationFn: async (maquinaId: string) => {
      const { data, error } = await (supabase.rpc as any)("aplicar_custo_hora_sugerido", {
        p_maquina_id: maquinaId,
      });
      if (error) throw error;
      return data as { custo_hora: number };
    },
    onSuccess: (r) => {
      toast.success(`Custo/hora definido em ${brl(Number(r.custo_hora))}`);
      qc.invalidateQueries({ queryKey: ["maquinas"] });
      qc.invalidateQueries({ queryKey: ["custo-hora-sugerido"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Foto do equipamento.
   *
   * Bucket público, ao contrário dos outros do projeto: foto de máquina não é
   * dado de cliente, aparece em lista e em card, e exigir URL assinada a cada
   * render trocaria um risco que não existe por lentidão que existe.
   */
  async function enviarFoto(maquinaId: string, arquivo: File) {
    setEnviandoFoto(maquinaId);
    try {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const caminho = `${maquinaId}/${Date.now()}.${ext}`;
      const { error: erroUpload } = await supabase.storage
        .from("maquinas-fotos")
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: true });
      if (erroUpload) throw erroUpload;

      const { data: pub } = supabase.storage.from("maquinas-fotos").getPublicUrl(caminho);
      const { data, error } = await (supabase as any)
        .from("maquinas")
        .update({ imagem_url: pub.publicUrl })
        .eq("id", maquinaId)
        .select("id");
      if (error) throw error;
      // Escrita barrada por RLS devolve 0 linhas e nenhum erro.
      if (!data || data.length === 0) throw new Error("Seu perfil não pode alterar máquinas.");

      toast.success("Foto atualizada");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar a foto");
    } finally {
      setEnviandoFoto(null);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        nome: form.nome,
        tipo: form.tipo || null,
        setor: form.setor || null,
        custo_hora: Number(form.custo_hora) || 0,
        potencia_kw: Number(form.potencia_kw) || 0,
        setup_min: Number(form.setup_min) || 0,
        velocidade_m2_h: Number(form.velocidade_m2_h) || 0,
        disponibilidade_pct: Number(form.disponibilidade_pct) || 0,
        fabricante: form.fabricante.trim() || null,
        modelo: form.modelo.trim() || null,
        // O "neurônio" da Vuze. É por ele que se abre chamado de garantia —
        // sem ele, achar a máquina no fabricante vira arqueologia de e-mail.
        numero_serie: form.numero_serie.trim() || null,
        // Boca da máquina: o gargalo do encaixe de bobina no orçamento.
        largura_util_m: form.largura_util_m ? Number(form.largura_util_m) : null,
        avanco_m: Number(form.avanco_m) || 0,
      };
      if (form.id) {
        const { error } = await supabase.from("maquinas").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("maquinas").insert({ ...payload, ativa: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Máquina atualizada" : "Máquina cadastrada");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, ativa }: { id: string; ativa: boolean }) => {
      const { error } = await supabase.from("maquinas").update({ ativa }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maquinas"] }),
  });

  const ativas = maquinas.filter((m) => m.ativa);
  const semCusto = maquinas.filter((m) => !m.custo_hora || Number(m.custo_hora) <= 0);
  const custoMedio =
    ativas.length > 0
      ? ativas.reduce((a, m) => a + Number(m.custo_hora ?? 0), 0) / ativas.length
      : 0;

  const openNew = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (m: (typeof maquinas)[number]) => {
    setForm({
      id: m.id,
      nome: m.nome,
      tipo: m.tipo ?? "",
      setor: m.setor ?? "",
      custo_hora: String(m.custo_hora ?? 0),
      potencia_kw: String(m.potencia_kw ?? 0),
      setup_min: String(m.setup_min ?? 0),
      velocidade_m2_h: String(m.velocidade_m2_h ?? 0),
      disponibilidade_pct: String(m.disponibilidade_pct ?? 100),
      fabricante: (m as any).fabricante ?? "",
      modelo: (m as any).modelo ?? "",
      numero_serie: (m as any).numero_serie ?? "",
      largura_util_m: (m as any).largura_util_m != null ? String((m as any).largura_util_m) : "",
      avanco_m: (m as any).avanco_m != null ? String((m as any).avanco_m) : "",
    });
    setOpen(true);
  };

  const field = (key: keyof Form, label: string, placeholder?: string, type = "text") => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div>
      <SectionHeader
        breadcrumb="Produção"
        title="Máquinas e hora-máquina"
        description="Cada equipamento precisa de custo/hora para que o orçamento e o resultado da OS fechem com a realidade."
        actions={
          <NeonButton onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nova máquina
          </NeonButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <KpiCard label="Máquinas ativas" value={ativas.length} icon={Factory} tone="cyan" />
        <KpiCard
          label="Custo/hora médio"
          value={brl(custoMedio)}
          icon={Gauge}
          tone="lime"
          hint="Base para o bloco Processos do orçamento"
        />
        <KpiCard
          label="Sem custo definido"
          value={semCusto.length}
          icon={Timer}
          tone={semCusto.length > 0 ? "magenta" : "muted"}
          hint={semCusto.length > 0 ? "O cálculo fica subestimado" : "Tudo parametrizado"}
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : maquinas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma máquina cadastrada
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {maquinas.map((m) => (
            <Card key={m.id} className="border-border">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <label
                      className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden cursor-pointer relative group"
                      title="Trocar a foto"
                    >
                      {m.imagem_url ? (
                        <img
                          src={m.imagem_url}
                          alt={m.nome}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <Factory className="h-5 w-5 text-[color:var(--bex-cyan)]" />
                      )}
                      <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-background/80 text-[10px] font-medium">
                        {enviandoFoto === m.id ? "..." : "trocar"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) enviarFoto(m.id, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <div className="min-w-0">
                      <div className="font-bold truncate">{m.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.tipo || "—"}
                        {m.setor ? ` · ${m.setor}` : ""}
                      </div>
                      {(m.fabricante || m.modelo) && (
                        <div className="text-xs text-muted-foreground truncate">
                          {[m.fabricante, m.modelo].filter(Boolean).join(" ")}
                          {m.numero_serie ? ` · nº ${m.numero_serie}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <StatusChip
                    label={m.ativa ? "Ativa" : "Inativa"}
                    tone={m.ativa ? "lime" : "muted"}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Custo/hora
                    </div>
                    <div className="font-bold">{brl(Number(m.custo_hora ?? 0))}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Potência
                    </div>
                    <div className="font-bold">{Number(m.potencia_kw ?? 0)} kW</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Setup
                    </div>
                    <div className="font-bold">{Number(m.setup_min ?? 0)} min</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Velocidade
                    </div>
                    <div className="font-bold">{Number(m.velocidade_m2_h ?? 0)} m²/h</div>
                  </div>
                </div>

                {m.largura_util_m != null && (
                  <div className="text-xs text-muted-foreground">
                    Boca de {Number(m.largura_util_m).toLocaleString("pt-BR")} m — é ela que
                    define quantas peças cabem na bobina.
                  </div>
                )}

                {/* O número em que a gráfica pensa.
                    Ninguém precifica banner por hora de máquina: precifica por
                    metro quadrado. Custo/hora sozinho engana — R$ 14,43 parece
                    caro até dividir pelos 14 m² que a máquina faz nessa hora. */}
                {Number(m.custo_hora ?? 0) > 0 && Number(m.velocidade_m2_h ?? 0) > 0 && (
                  <div className="rounded-md border bg-muted/40 p-2 text-xs">
                    <div className="font-medium">
                      {brl(Number(m.custo_hora) / Number(m.velocidade_m2_h))} por m² de máquina
                    </div>
                    <div className="text-muted-foreground">
                      {brl(Number(m.custo_hora))}/h ÷ {Number(m.velocidade_m2_h)} m²/h. É este
                      valor que entra no orçamento, proporcional à metragem da peça — não a
                      hora cheia.
                    </div>
                  </div>
                )}

                {/* Sem velocidade, a hora é digitada à mão — e digitar "1 hora"
                    num banner de 2 m² cobra a hora inteira em vez do minuto que
                    a peça usou. É assim que o orçamento estoura. */}
                {Number(m.custo_hora ?? 0) > 0 && Number(m.velocidade_m2_h ?? 0) <= 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    <div className="font-medium text-amber-700 dark:text-amber-500">
                      Sem velocidade cadastrada
                    </div>
                    <div className="text-muted-foreground">
                      O orçamento vai pedir as horas digitadas. Uma hora cheia numa peça de
                      poucos minutos cobra {brl(Number(m.custo_hora))} a mais do que devia.
                    </div>
                  </div>
                )}

                {/* Os parâmetros que fazem o preço, editáveis aqui: modos de
                    qualidade na impressora, tabela de velocidade no laser.
                    Semear na migração e não dar onde corrigir seria congelar
                    uma estimativa dentro do preço de venda. */}
                <ParametrosDeMaquina maquinaId={m.id} base={(m as any).base_cobranca ?? null} />

                {/* Ficha técnica em formato livre: cada tipo de máquina tem a sua.
                    Uma fresa a laser fala em tubo e área de gravação; um plotter,
                    em força de corte. */}
                {m.especificacoes && Object.keys(m.especificacoes as object).length > 0 && (
                  <details className="rounded-md border bg-muted/30 p-2">
                    <summary className="cursor-pointer text-xs font-medium">
                      Ficha técnica
                    </summary>
                    <dl className="mt-2 space-y-1 text-xs">
                      {Object.entries(m.especificacoes as Record<string, unknown>)
                        .filter(([chave]) => chave !== "fonte_ficha")
                        .map(([chave, valor]) => (
                          <div key={chave} className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">
                              {chave.replace(/_/g, " ")}
                            </dt>
                            <dd className="font-mono text-right">
                              {typeof valor === "boolean" ? (valor ? "sim" : "não") : String(valor)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                    {(m.especificacoes as Record<string, unknown>).fonte_ficha ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Fonte: {String((m.especificacoes as Record<string, unknown>).fonte_ficha)}
                      </p>
                    ) : null}
                  </details>
                )}

                {canSeeFinancials && contratoPorMaquina.get(m.id) && (
                  <div className="rounded-md border border-[color:var(--bex-cyan)]/30 bg-[color:var(--bex-cyan)]/5 p-2 text-xs space-y-1">
                    <div className="font-medium">
                      {contratoPorMaquina.get(m.id)!.condicao_comercial ?? "Contrato"}
                    </div>
                    {contratoPorMaquina.get(m.id)!.valor_parcela ? (
                      <div>
                        {contratoPorMaquina.get(m.id)!.parcelas}× de{" "}
                        {brl(Number(contratoPorMaquina.get(m.id)!.valor_parcela))}
                      </div>
                    ) : null}
                    {contratoPorMaquina.get(m.id)!.valor_total ? (
                      <div>Valor: {brl(Number(contratoPorMaquina.get(m.id)!.valor_total))}</div>
                    ) : null}
                    {contratoPorMaquina.get(m.id)!.creditos != null ? (
                      <div>Créditos: {contratoPorMaquina.get(m.id)!.creditos}</div>
                    ) : null}
                    <div className="text-muted-foreground">
                      Contrato{" "}
                      {contratoPorMaquina.get(m.id)!.numero_contrato ??
                        contratoPorMaquina.get(m.id)!.numero_negociacao ??
                        "—"}
                    </div>
                  </div>
                )}

                {Number(m.custo_hora ?? 0) <= 0 &&
                  (sugestoes[m.id]?.custo_hora ? (
                    <div className="rounded-md border border-[color:var(--bex-magenta)]/40 bg-[color:var(--bex-magenta)]/5 p-2 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-medium">
                        <Zap className="h-3.5 w-3.5" />
                        Sugestão: {brl(Number(sugestoes[m.id].custo_hora))}/hora
                      </div>
                      <div className="text-muted-foreground">{sugestoes[m.id].conta}</div>
                      {sugestoes[m.id].horas_presumidas && (
                        <div className="text-muted-foreground">
                          As 160 h/mês são presumidas (8 h × 20 dias). Com a hora real, o custo
                          muda na mesma proporção.
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={aplicarCusto.isPending}
                        onClick={() => aplicarCusto.mutate(m.id)}
                      >
                        Usar este valor
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-xs text-[color:var(--bex-magenta)]">
                      <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Sem custo/hora, esta máquina sai de graça no orçamento.
                        {sugestoes[m.id]?.metodo === "sem_dados"
                          ? " Cadastre o valor de aquisição ou a parcela para o sistema calcular."
                          : ""}
                      </span>
                    </div>
                  ))}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(m)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle.mutate({ id: m.id, ativa: !m.ativa })}
                  >
                    {m.ativa ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar máquina" : "Cadastrar máquina"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("nome", "Nome *", "Plotter Roland XR-640")}</div>
            {field("tipo", "Tipo", "Impressão eco-solvente")}
            {field("setor", "Setor", "Impressão")}
            {field("fabricante", "Fabricante", "Vuze")}
            {field("modelo", "Modelo", "VC10060-LM")}
            {field("numero_serie", "Nº de série / neurônio", "FD2D54")}
            {field("largura_util_m", "Boca da máquina (m)", "1.80", "number")}
            {field("custo_hora", "Custo/hora (R$)", "40", "number")}
            {field("potencia_kw", "Potência (kW)", "1.5", "number")}
            {field("setup_min", "Setup (min)", "15", "number")}
            {field("velocidade_m2_h", "Velocidade (m²/h)", "12", "number")}
            {/* O rolo avança para carregar e para cortar. Em peça pequena esse
                avanço É o consumo: 20 cm perdidos numa tira de 20 cm dobram o
                material, e a conta de aproveitamento ignorava isso. */}
            {field("avanco_m", "Avanço por trabalho (m)", "0.20", "number")}
            <div className="sm:col-span-2">
              {field("disponibilidade_pct", "Disponibilidade (%)", "85", "number")}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={!form.nome || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
