import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FunilDoOrcamento } from "@/components/orcamento/funil-do-orcamento";
import { Checkbox } from "@/components/ui/checkbox";
import { chaveWhatsApp } from "@/domain/documentos";
import { telefoneParaZapi } from "@/domain/whatsapp/zapi-envio";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { DataPanel } from "@/components/bex/DataPanel";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";

export const Route = createFileRoute("/_authenticated/orcamentos/")({
  head: () => ({ meta: [{ title: "Orçamentos — BEX PRINT OS" }] }),
  component: OrcamentosPage,
});

const statusTone: Record<string, "cyan" | "magenta" | "lime" | "amber" | "muted"> = {
  rascunho: "muted",
  enviado: "cyan",
  aprovado: "lime",
  rejeitado: "magenta",
  expirado: "amber",
  convertido: "lime",
};
const statusLabel: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  expirado: "Expirado",
  convertido: "Convertido em OS",
};

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function OrcamentosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // valor_total do orçamento é preço de venda: o vendedor precisa ver.
  // Custo/margem não aparecem nesta tela, então canSeeFinancials não entra aqui.
  const { canSeePrices, nivelDeVisao, hasPermission } = useAuth();
  // Converter em OS é `orcamentos.convert` (gerente, admin e o atendimento/vendedor, desde
  // 25/10/2026), e o banco só aceita orçamento aprovado. O botão aparece só onde a conversão é possível.
  const podeConverter = hasPermission("orcamentos.convert");
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  // Cascas (25/10/2026): 26 orçamentos antigos, rejeitados ou expirados, sem nenhum valor — sobras
  // do botão que criava um orçamento por clique. Ficam escondidos; o botão abaixo mostra de novo.
  const [mostrarCascas, setMostrarCascas] = useState(false);

  const [form, setForm] = useState({
    cliente_id: "",
    contato_nome: "",
    contato_telefone: "",
    contato_email: "",
    titulo: "",
  });
  // Contato avulso com telefone vira cliente no ato (26/10/2026): 8 de 10 rascunhos estavam sem cliente,
  // e sem cliente a conversão em OS (e a automática) recusa. Desmarque para manter avulso.
  const [cadastrarContato, setCadastrarContato] = useState(true);
  // Peça 3D (27/10/2026): o orçamento nasce igual aos outros e a calculadora abre em cima.
  const [comecarPelo3d, setComecarPelo3d] = useState(false);

  const { data: orcamentos = [], isLoading } = useQuery({
    queryKey: ["orcamentos", nivelDeVisao],
    queryFn: async () => {
      // select("*") se adapta à view do nível: nunca pede coluna que ela não tem.
      const { data, error } = await fromFinancialView("orcamentos", nivelDeVisao)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-select"],
    queryFn: async () => {
      const { data } = await supabase.from("clientes").select("id, nome").order("nome");
      return data ?? [];
    },
  });

  // Orçamentos originados no módulo 3D (para exibir tipo e link no funil único)
  const { data: mapa3d = {} } = useQuery({
    queryKey: ["orcamentos-3d-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orcamentos_3d")
        .select("id, orcamento_id")
        .not("orcamento_id", "is", null);
      const map: Record<string, string> = {};
      for (const r of data ?? []) if (r.orcamento_id) map[r.orcamento_id] = r.id;
      return map;
    },
  });

  // Só para quem vê preço: sem valor na view, "sem valor" seria chute.
  const ehCasca = (o: any) => canSeePrices && ["rejeitado", "expirado"].includes(o.status) && !(Number(o.valor_total ?? 0) > 0) && !o.os_id;
  const qtdCascas = useMemo(() => (orcamentos as any[]).filter(ehCasca).length, [orcamentos]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = mostrarCascas ? (orcamentos as any[]) : (orcamentos as any[]).filter((o) => !ehCasca(o));
    if (!termo) return base;
    return base.filter((o) =>
      [o.numero, o.titulo, o.cliente_nome, o.contato_nome]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    );
  }, [orcamentos, busca, mostrarCascas]);

  const kpis = useMemo(() => {
    const lista = orcamentos as any[];
    // Virou OS é ter `os_id`, não o status: a conversão comum deixa o
    // orçamento "aprovado" (o portal e o painel do parceiro contam por ele),
    // e os 6 convertidos em 13/10 entravam em "em aberto".
    const viraramOs = lista.filter((o) => o.status === "convertido" || !!o.os_id);
    const abertos = lista.filter(
      (o) => !o.os_id && !["convertido", "rejeitado", "expirado"].includes(o.status),
    );
    const soma = (l: any[]) => l.reduce((a, o) => a + Number(o.valor_total ?? 0), 0);
    // Antes "Aguardando aprovação" contava enviado E aprovado: os 7 aprovados
    // de 07/10/2026 apareciam como se esperassem o cliente, quando esperavam
    // a gráfica converter. E "Valor total" somava rejeitado e convertido.
    const comCliente = lista.filter((o) => o.status === "enviado");
    const aprovadosSemOs = lista.filter((o) => o.status === "aprovado" && !o.os_id);
    return {
      abertos: abertos.length,
      comCliente: comCliente.length,
      valorComCliente: soma(comCliente),
      aprovadosSemOs: aprovadosSemOs.length,
      valorAprovadosSemOs: soma(aprovadosSemOs),
      convertidos: viraramOs.length,
      valorEmAberto: soma(abertos),
    };
  }, [orcamentos]);

  // Trava enquanto grava (21/10/2026): os orçamentos #93 e #94 "PLACA
  // ACRILICA" nasceram com 0,08 s de diferença — dois toques no "Criar". O
  // mesmo defeito do "Novo cliente" (YRLEN ×5); a ref barra o segundo toque
  // antes mesmo do React redesenhar o botão desabilitado.
  const criandoRef = useRef(false);
  const [criando, setCriando] = useState(false);

  async function handleCreate() {
    if (criandoRef.current) return;
    if (!form.titulo) return toast.error("Título é obrigatório");
    if (!form.cliente_id && !form.contato_nome.trim())
      return toast.error("Informe um cliente cadastrado ou o nome do contato");
    criandoRef.current = true;
    setCriando(true);
    try {
      let clienteId = form.cliente_id || null;
      let contatoVirouCliente = false;
      if (!clienteId && cadastrarContato && form.contato_nome.trim() && chaveWhatsApp(form.contato_telefone)) {
        // Mesmo número já cadastrado: usa o cliente que existe em vez de duplicar.
        const chave = chaveWhatsApp(form.contato_telefone);
        const { data: existente, error: erroBusca } = await (supabase as any)
          .from("clientes")
          .select("id")
          .eq("telefone_normalizado", chave)
          .eq("ativo", true)
          .limit(2);
        if (erroBusca) {
          // Sem conseguir conferir duplicata, não cadastra: contato avulso é melhor que cliente repetido.
          toast.warning("Não consegui conferir se o cliente já existe; o orçamento segue com contato avulso.");
        } else if (existente?.length === 1) {
          clienteId = existente[0].id;
          contatoVirouCliente = true;
        } else if (existente.length === 0) {
          const { data: novo, error: erroCliente } = await (supabase as any)
            .from("clientes")
            .insert({
              nome: form.contato_nome.trim(),
              tipo: "pf",
              tipo_cliente: "pf",
              telefone: form.contato_telefone.trim(),
              whatsapp_principal: form.contato_telefone.trim(),
              email: form.contato_email.trim() || null,
            })
            .select("id")
            .single();
          if (erroCliente) toast.warning("Não consegui cadastrar o cliente; o orçamento segue com contato avulso.");
          else {
            clienteId = novo.id;
            contatoVirouCliente = true;
          }
        }
      }
      const { data: criado, error } = await supabase
        .from("orcamentos")
        .insert({
          cliente_id: clienteId,
          contato_nome: clienteId ? null : form.contato_nome.trim(),
          contato_telefone: clienteId ? null : form.contato_telefone.trim() || null,
          contato_email: clienteId ? null : form.contato_email.trim() || null,
          titulo: form.titulo,
          valor_total: 0,
          valor_subtotal: 0,
        } as any)
        .select("id")
        .single();
      if (error) return toast.error(mensagemErro(error));
      toast.success(
        contatoVirouCliente ? "Orçamento criado e cliente cadastrado — lance os produtos" : "Orçamento criado — lance os produtos",
      );
      setOpen(false);
      setForm({
        cliente_id: "",
        contato_nome: "",
        contato_telefone: "",
        contato_email: "",
        titulo: "",
      });
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
      const novoId = (criado as { id: string } | null)?.id;
      if (novoId && comecarPelo3d) {
        try {
          sessionStorage.setItem("bex.orcamento.abrir3d", novoId);
        } catch {
          /* sem sessionStorage */
        }
      }
      setComecarPelo3d(false);
      if (novoId) navigate({ to: "/orcamentos/$id", params: { id: novoId } });
    } finally {
      criandoRef.current = false;
      setCriando(false);
    }
  }

  async function converterEmOS(orc: any) {
    if (!orc.cliente_id)
      return toast.error(
        "Vincule um cliente cadastrado a este orçamento antes de convertê-lo em OS.",
      );
    const orc3dId = mapa3d[orc.id];
    const { data, error } = orc3dId
      ? await (supabase.rpc as any)("converter_orcamento_3d_em_os", { p_orcamento_3d_id: orc3dId })
      : await (supabase.rpc as any)("converter_orcamento_em_os", {
          p_orcamento_id: orc.id,
          p_opcoes: {},
        });
    if (error) return toast.error(mensagemErro(error));
    const osId =
      typeof data === "object" && data && "os_id" in data ? String((data as any).os_id) : "";
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
    qc.invalidateQueries({ queryKey: ["kanban-os"] });
    // O código interno da OS não diz nada a ninguém: abre a OS criada.
    toast.success(`OS criada para o orçamento #${orc.numero}`, { description: "Abrindo a ordem de serviço." });
    if (osId) navigate({ to: "/os/$id", params: { id: osId } });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/orcamentos")}
        breadcrumb="Print OS · Comercial"
        title="Orçamentos"
        description="Propostas comerciais e conversão em Ordens de Serviço."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Novo orçamento
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo orçamento</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Cliente
                    <DicaIcone texto={dicaCampo("/orcamentos", "Cliente")} rotulo="Cliente" />
                  </Label>
                  <Select
                    value={form.cliente_id || "__avulso"}
                    onValueChange={(v) =>
                      setForm({ ...form, cliente_id: v === "__avulso" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__avulso">Sem cadastro (contato avulso)</SelectItem>
                      {clientes.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Para virar OS é preciso ter cliente cadastrado; com telefone, o contato avulso é cadastrado por você.
                  </p>
                </div>
                {!form.cliente_id && (
                  <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border/60 bg-card/40 p-3">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        Nome do contato *
                        <DicaIcone
                          texto={dicaCampo("/orcamentos", "Nome do contato *")}
                          rotulo="Nome do contato *"
                        />
                      </Label>
                      <Input
                        value={form.contato_nome}
                        onChange={(e) => setForm({ ...form, contato_nome: e.target.value })}
                        placeholder="Ex.: Marina (Instagram)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        Telefone
                        <DicaIcone texto={dicaCampo("/orcamentos", "Telefone")} rotulo="Telefone" />
                      </Label>
                      <Input
                        value={form.contato_telefone}
                        onChange={(e) => setForm({ ...form, contato_telefone: e.target.value })}
                        placeholder="(00) 00000-0000"
                      />
                      {form.contato_telefone.trim() && !telefoneParaZapi(form.contato_telefone) && (
                        <p className="text-xs text-amber-500">
                          Esse número não parece um celular com WhatsApp (DDD + 9 dígitos). O envio pelo sistema não vai funcionar.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        E-mail
                        <DicaIcone texto={dicaCampo("/orcamentos", "E-mail")} rotulo="E-mail" />
                      </Label>
                      <Input
                        value={form.contato_email}
                        onChange={(e) => setForm({ ...form, contato_email: e.target.value })}
                        placeholder="contato@email.com"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-3">
                      <Checkbox
                        checked={cadastrarContato}
                        onCheckedChange={(v) => setCadastrarContato(v === true)}
                      />
                      Cadastrar este contato como cliente (com telefone, já fica pronto para virar OS)
                    </label>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Título *
                    <DicaIcone texto={dicaCampo("/orcamentos", "Título *")} rotulo="Título *" />
                  </Label>
                  <Input
                    value={form.titulo}
                    onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={comecarPelo3d} onCheckedChange={(v) => setComecarPelo3d(v === true)} />
                  É uma peça de impressão 3D (abre a calculadora: print do fatiador, filamento, foto)
                </label>
                <p className="text-xs text-muted-foreground">
                  O valor é calculado automaticamente pelos produtos que você lançar na próxima
                  tela.
                </p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={criando}>
                  {criando ? "Criando…" : "Criar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {podeConverter && <FunilDoOrcamento />}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Orçamentos em aberto" value={kpis.abertos} tone="cyan" icon={FileText} />
        <KpiCard
          label="Aguardando o cliente"
          value={kpis.comCliente}
          tone="amber"
          hint={
            canSeePrices
              ? `Enviados ao cliente e ainda sem resposta. Total ${moeda(kpis.valorComCliente)}.`
              : "Enviados ao cliente e ainda sem resposta."
          }
        />
        <KpiCard
          label="Aprovados sem OS"
          value={kpis.aprovadosSemOs}
          tone="magenta"
          hint={
            `O cliente aprovou e a produção ainda não foi avisada: falta "Converter em OS".` +
            (canSeePrices ? ` Total ${moeda(kpis.valorAprovadosSemOs)}.` : "") +
            ` Já viraram OS: ${kpis.convertidos}.`
          }
        />
        <KpiCard
          label={canSeePrices ? "Valor em aberto" : "Total de orçamentos"}
          value={canSeePrices ? moeda(kpis.valorEmAberto) : orcamentos.length}
          tone="cyan"
          hint={
            canSeePrices
              ? "Soma dos orçamentos em aberto: rascunho, enviado e aprovado sem OS. Rejeitado, expirado e convertido ficam de fora."
              : undefined
          }
        />
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar orçamento..."
        rodape={
          <>
            <span>
              Mostrando {filtrados.length} de {orcamentos.length} orçamentos
            </span>
            {qtdCascas > 0 && (
              <button
                type="button"
                className="ml-3 underline underline-offset-2 hover:text-foreground"
                aria-pressed={mostrarCascas}
                onClick={() => setMostrarCascas((v) => !v)}
              >
                {mostrarCascas ? "Esconder" : "Mostrar"} {qtdCascas} rejeitados/expirados sem valor
              </button>
            )}
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              {canSeePrices && <TableHead>Valor</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="py-2">
                  <Carregando />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhum orçamento
                </TableCell>
              </TableRow>
            )}
            {filtrados.map((o: any) => {
              return (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/orcamentos/$id", params: { id: o.id } })}
                >
                  <TableCell className="font-mono text-xs text-[color:var(--bex-cyan)]">
                    #{o.numero}
                  </TableCell>
                  <TableCell className="font-bold text-foreground">{o.titulo}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {mapa3d[o.id] ? (
                      <Link to="/orcamento-3d/$id" params={{ id: mapa3d[o.id] }}>
                        <StatusChip label="Impressão 3D" tone="magenta" />
                      </Link>
                    ) : (
                      <StatusChip label="Comunicação visual" tone="cyan" />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.cliente_nome ?? (
                      <span className="inline-flex items-center gap-1.5">
                        {o.contato_nome ?? "—"}
                        <StatusChip label="sem cadastro" tone="amber" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={statusLabel[o.status] ?? o.status}
                      tone={statusTone[o.status] ?? "muted"}
                    />
                  </TableCell>
                  {canSeePrices && (
                    <TableCell className="font-bold text-foreground">
                      {moeda(Number(o.valor_total))}
                    </TableCell>
                  )}
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {/* Só aprovado e sem OS: em rascunho, enviado ou rejeitado o
                        banco recusa ("Orçamento sem versão aprovada"), e o botão
                        em todas as linhas escondia quais 7 esperavam a gráfica. */}
                    {podeConverter && o.status === "aprovado" && !o.os_id && (
                      <Button size="sm" onClick={() => converterEmOS(o)}>
                        Converter em OS <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                    {o.os_id && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/os/$id" params={{ id: o.os_id }}>
                          Ver a OS <ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataPanel>
    </div>
  );
}
