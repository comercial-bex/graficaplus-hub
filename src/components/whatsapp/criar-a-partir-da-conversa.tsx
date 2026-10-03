/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  pedidoDaConversa,
  telefoneLegivel,
  tituloSugerido,
  type ConversaDaCaixa,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import { CHAVES, ligarConversaAOs } from "@/components/whatsapp/usar-caixa-de-entrada";

/**
 * "Criar orçamento" a partir da conversa.
 *
 * Abre o orçamento NOVO já com o cliente (ou o contato avulso, com o nome e o
 * telefone da conversa) e com o pedido — as últimas mensagens do cliente —, e
 * leva para a tela do orçamento para lançar os produtos. É a mesma gravação de
 * /orcamentos ("Novo orçamento"), mais três ligações que a tabela já tinha e
 * ninguém preenchia:
 *
 *   conversa_id  de qual conversa saiu (sem FK; a coluna existia vazia)
 *   lead_id      o lead que o webhook abriu para o número desconhecido
 *   briefing     o pedido do cliente — converter_orcamento_em_os COPIA este
 *                campo para a OS, então a produção recebe o que foi pedido
 *   descricao    o mesmo pedido, legível pelas três views de orçamento
 *
 * `observacoes` fica de fora de propósito: ela é impressa no PDF que vai para
 * o cliente, e a conversa interna não pertence a esse papel.
 */
export function CriarOrcamentoDaConversa({
  conversa,
  mensagens,
}: {
  conversa: ConversaDaCaixa;
  mensagens: MensagemDaCaixa[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [form, setForm] = useState({
    titulo: "",
    contatoNome: "",
    contatoTelefone: "",
    pedido: "",
  });

  function abrir() {
    // O rascunho nasce da conversa NA HORA de abrir: mensagens que chegaram
    // depois entram, e o que a pessoa editar fica até ela fechar.
    setForm({
      titulo: tituloSugerido(conversa),
      contatoNome: conversa.nome_contato ?? conversa.lead?.nome ?? "",
      contatoTelefone: telefoneLegivel(conversa.telefone),
      pedido: pedidoDaConversa(mensagens),
    });
    setAberto(true);
  }

  async function criar() {
    const titulo = form.titulo.trim();
    if (!titulo) return toast.error("Título é obrigatório");
    if (!conversa.cliente_id && !form.contatoNome.trim()) {
      return toast.error("Informe o nome do contato ou vincule a conversa a um cliente");
    }
    const pedido = form.pedido.trim() || null;
    setGravando(true);
    try {
      const { data, error } = await supabase
        .from("orcamentos")
        .insert({
          cliente_id: conversa.cliente_id,
          contato_nome: conversa.cliente_id ? null : form.contatoNome.trim(),
          contato_telefone: conversa.cliente_id ? null : form.contatoTelefone.trim() || null,
          titulo,
          descricao: pedido,
          briefing: pedido,
          conversa_id: conversa.id,
          lead_id: conversa.lead_id,
          valor_total: 0,
          valor_subtotal: 0,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Orçamento criado com o pedido da conversa — lance os produtos");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["orcamentos"] });
      if (conversa.cliente_id)
        void qc.invalidateQueries({ queryKey: ["wa-caixa-historico", conversa.cliente_id] });
      const id = (data as { id: string } | null)?.id;
      if (id) navigate({ to: "/orcamentos/$id", params: { id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-full justify-start" onClick={abrir}>
        <FileText className="mr-2 h-4 w-4" /> Criar orçamento
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => !gravando && setAberto(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo orçamento a partir da conversa</DialogTitle>
            <DialogDescription>
              O valor sai dos produtos que você lançar na próxima tela. O pedido abaixo vai junto e
              segue para a OS quando o orçamento for convertido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {conversa.cliente ? (
              <p className="text-sm">
                Cliente: <span className="font-medium">{conversa.cliente.nome}</span>
              </p>
            ) : (
              <div className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Conversa sem cliente cadastrado: o orçamento sai como contato avulso. O cliente só
                  é exigido na conversão em OS.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="wa-orc-nome">Nome do contato *</Label>
                  <Input
                    id="wa-orc-nome"
                    value={form.contatoNome}
                    onChange={(e) => setForm({ ...form, contatoNome: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wa-orc-tel">Telefone</Label>
                  <Input
                    id="wa-orc-tel"
                    value={form.contatoTelefone}
                    onChange={(e) => setForm({ ...form, contatoTelefone: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="wa-orc-titulo">Título *</Label>
              <Input
                id="wa-orc-titulo"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-orc-pedido">Pedido do cliente</Label>
              <Textarea
                id="wa-orc-pedido"
                rows={6}
                value={form.pedido}
                onChange={(e) => setForm({ ...form, pedido: e.target.value })}
                placeholder="Nenhuma mensagem do cliente com texto nesta conversa."
              />
              <p className="text-xs text-muted-foreground">
                Últimas mensagens do cliente, com dia e hora. Edite o que quiser antes de criar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={gravando}>
              Cancelar
            </Button>
            <Button onClick={() => void criar()} disabled={gravando}>
              Criar orçamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Criar OS" a partir da conversa — o mesmo caminho do "Nova OS" de /os
 * (mesmas colunas, a mesma pergunta de como a peça sai), com o cliente da
 * conversa e o pedido no briefing. Depois de criada, a conversa fica ligada à
 * OS (`whatsapp_conversas.os_id`): o webhook copia esse vínculo para cada
 * mensagem nova, e é por ele que o Monitor do WhatsApp lista as mensagens da
 * OS.
 *
 * Só aparece com cliente vinculado (a OS exige cliente) e para quem tem
 * `os.create`. A conversão de orçamento em OS já é do gerente/admin na
 * gráfica; abrir OS direto do chat segue a mesma régua. Sem isso, a tela
 * leva ao orçamento.
 */
export function CriarOsDaConversa({
  conversa,
  mensagens,
}: {
  conversa: ConversaDaCaixa & { cliente_id: string };
  mensagens: MensagemDaCaixa[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canSeePrices } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [form, setForm] = useState({
    titulo: "",
    briefing: "",
    prazo_entrega: "",
    prioridade: "3",
    valor_total: "",
    saida: "retirada" as "retirada" | "entrega" | "instalacao",
  });

  function abrir() {
    setForm({
      titulo: tituloSugerido(conversa),
      briefing: pedidoDaConversa(mensagens),
      prazo_entrega: "",
      prioridade: "3",
      valor_total: "",
      saida: "retirada",
    });
    setAberto(true);
  }

  async function criar() {
    const titulo = form.titulo.trim();
    if (!titulo) return toast.error("Título é obrigatório");
    setGravando(true);
    try {
      const { data, error } = await supabase
        .from("ordens_servico")
        .insert({
          cliente_id: conversa.cliente_id,
          titulo,
          briefing: form.briefing.trim() || null,
          prazo_entrega: form.prazo_entrega || null,
          prioridade: parseInt(form.prioridade),
          valor_total: canSeePrices ? parseFloat(form.valor_total || "0") : 0,
          precisa_entrega: form.saida === "entrega",
          precisa_instalacao: form.saida === "instalacao",
        })
        .select("id, numero")
        .single();
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["os-list"] });
      try {
        await ligarConversaAOs(conversa.id, data.id);
        toast.success(`OS #${data.numero} criada e ligada a esta conversa`);
      } catch (e) {
        // A OS existe; só o vínculo falhou. Dizer as duas coisas.
        toast.warning(
          `OS #${data.numero} criada, mas a conversa não ficou ligada a ela: ${mensagemErro(e)}`,
        );
      }
      void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      setAberto(false);
      navigate({ to: "/os/$id", params: { id: data.id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-full justify-start" onClick={abrir}>
        <ClipboardList className="mr-2 h-4 w-4" /> Criar OS
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => !gravando && setAberto(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova OS a partir da conversa</DialogTitle>
            <DialogDescription>
              Cliente: {conversa.cliente?.nome ?? "vinculado"}. A OS nasce sem itens e sem orçamento
              — use para serviço já combinado. Para preço por produto, crie o orçamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wa-os-titulo">Título *</Label>
              <Input
                id="wa-os-titulo"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-os-briefing">Briefing</Label>
              <Textarea
                id="wa-os-briefing"
                rows={5}
                value={form.briefing}
                onChange={(e) => setForm({ ...form, briefing: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="wa-os-prazo">Prazo entrega</Label>
                <Input
                  id="wa-os-prazo"
                  type="date"
                  value={form.prazo_entrega}
                  onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Prioridade</Label>
                <Select
                  value={form.prioridade}
                  onValueChange={(v) => setForm({ ...form, prioridade: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 — Urgente</SelectItem>
                    <SelectItem value="2">2 — Alta</SelectItem>
                    <SelectItem value="3">3 — Normal</SelectItem>
                    <SelectItem value="4">4 — Baixa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* A mesma pergunta de /os: sem ela o gatilho que abre a entrega
                nunca dispara. */}
            <div className="space-y-2">
              <Label>Como a peça sai *</Label>
              <Select value={form.saida} onValueChange={(v: any) => setForm({ ...form, saida: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retirada">O cliente retira no balcão</SelectItem>
                  <SelectItem value="entrega">A gráfica entrega</SelectItem>
                  <SelectItem value="instalacao">A gráfica instala no local</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canSeePrices && (
              <div className="space-y-2">
                <Label htmlFor="wa-os-valor">Valor total (R$)</Label>
                <Input
                  id="wa-os-valor"
                  type="number"
                  step="0.01"
                  value={form.valor_total}
                  onChange={(e) => setForm({ ...form, valor_total: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={gravando}>
              Cancelar
            </Button>
            <Button onClick={() => void criar()} disabled={gravando}>
              Criar OS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
