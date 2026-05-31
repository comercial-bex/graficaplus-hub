import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Send, Paperclip, FileText, ClipboardList, User, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { enviarTextoWhatsapp } from "@/lib/api/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — BEX PRINT OS" }] }),
  component: WhatsAppPage,
});

type Conversa = {
  id: string;
  instancia_id: string;
  telefone: string;
  nome_contato: string | null;
  cliente_id: string | null;
  lead_id: string | null;
  os_id: string | null;
  status: string;
  etiquetas: string[] | null;
  ultima_mensagem: string | null;
  ultima_mensagem_at: string | null;
  nao_lidas: number;
  clientes?: { nome: string | null; telefone: string | null } | null;
  leads?: { nome: string | null; telefone: string | null } | null;
};

type Mensagem = {
  id: string;
  direcao: "entrada" | "saida";
  tipo: string;
  status: string;
  texto: string | null;
  legenda: string | null;
  media_url: string | null;
  storage_path: string | null;
  created_at: string;
};

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function contactName(conversa: Conversa) {
  return (
    conversa.clientes?.nome ?? conversa.leads?.nome ?? conversa.nome_contato ?? conversa.telefone
  );
}

function messagePreview(mensagem: Mensagem) {
  if (mensagem.texto) return mensagem.texto;
  if (mensagem.legenda) return mensagem.legenda;
  return mensagem.tipo === "texto" ? "Mensagem" : `Mídia: ${mensagem.tipo}`;
}

function WhatsAppPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const { data: conversas = [], isLoading: loadingConversas } = useQuery({
    queryKey: ["whatsapp-conversas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversas" as never)
        .select("*, clientes(nome, telefone), leads(nome, telefone)" as never)
        .order("ultima_mensagem_at" as never, { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Conversa[];
    },
  });

  const selected = useMemo(() => {
    if (!conversas.length) return null;
    return conversas.find((c) => c.id === selectedId) ?? conversas[0];
  }, [conversas, selectedId]);

  const filteredConversas = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversas;
    return conversas.filter((c) =>
      `${contactName(c)} ${c.telefone} ${c.ultima_mensagem ?? ""}`.toLowerCase().includes(term),
    );
  }, [conversas, search]);

  const { data: mensagens = [], isLoading: loadingMensagens } = useQuery({
    queryKey: ["whatsapp-mensagens", selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_mensagens" as never)
        .select("id,direcao,tipo,status,texto,legenda,media_url,storage_path,created_at" as never)
        .eq("conversa_id" as never, selected!.id)
        .order("created_at" as never, { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Mensagem[];
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !message.trim()) return;
      return enviarTextoWhatsapp({
        data: {
          instanciaId: selected.instancia_id,
          conversaId: selected.id,
          phone: selected.telefone,
          text: message.trim(),
          clienteId: selected.cliente_id ?? undefined,
          osId: selected.os_id ?? undefined,
        },
      });
    },
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: ["whatsapp-conversas"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens", selected?.id] });
    },
  });

  return (
    <div className="h-[calc(100vh-8rem)] grid grid-cols-12 gap-4">
      <Card className="col-span-3 flex flex-col overflow-hidden">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar conversa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {loadingConversas && (
            <div className="p-4 text-sm text-muted-foreground">Carregando conversas...</div>
          )}
          {!loadingConversas && filteredConversas.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Nenhuma conversa encontrada.</div>
          )}
          {filteredConversas.map((c) => {
            const nome = contactName(c);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors ${selected?.id === c.id ? "bg-muted" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>{nome[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-sm truncate">{nome}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatTime(c.ultima_mensagem_at)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.ultima_mensagem ?? "Sem mensagens"}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] py-0">
                        {c.status}
                      </Badge>
                      {(c.etiquetas ?? []).slice(0, 1).map((etiqueta) => (
                        <Badge key={etiqueta} variant="outline" className="text-[10px] py-0">
                          {etiqueta}
                        </Badge>
                      ))}
                      {c.nao_lidas > 0 && (
                        <Badge className="text-[10px] py-0 bg-emerald-600 hover:bg-emerald-600">
                          {c.nao_lidas}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="col-span-6 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="p-3 border-b flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{contactName(selected)[0]?.toUpperCase() ?? "?"}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{contactName(selected)}</div>
                <div className="text-xs text-muted-foreground">{selected.telefone}</div>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3 bg-muted/20">
              {loadingMensagens && (
                <div className="text-sm text-muted-foreground">Carregando mensagens...</div>
              )}
              {!loadingMensagens && mensagens.length === 0 && (
                <div className="text-sm text-muted-foreground">Sem mensagens nesta conversa.</div>
              )}
              {mensagens.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-2.5 text-sm ${m.direcao === "saida" ? "bg-emerald-600 text-white" : "bg-card border"}`}
                  >
                    {m.media_url && (
                      <div className="mb-1 text-xs underline break-all">{m.media_url}</div>
                    )}
                    <div>{messagePreview(m)}</div>
                    <div
                      className={`text-[10px] mt-1 ${m.direcao === "saida" ? "text-emerald-50" : "text-muted-foreground"}`}
                    >
                      {formatTime(m.created_at)} · {m.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="p-3 border-t flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendMutation.mutate();
              }}
            >
              <Button variant="ghost" size="icon" type="button">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                placeholder="Digite uma mensagem..."
                className="flex-1"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button
                size="icon"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!message.trim() || sendMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        ) : (
          <div className="m-auto text-sm text-muted-foreground">
            Selecione uma conversa para começar.
          </div>
        )}
      </Card>

      <Card className="col-span-3 flex flex-col overflow-auto">
        {selected ? (
          <>
            <div className="p-4 border-b">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Cliente/lead
              </div>
              <div className="flex items-center gap-2 font-medium">
                <User className="h-4 w-4" /> {contactName(selected)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{selected.telefone}</div>
              <div className="mt-2 flex gap-2">
                {selected.cliente_id && <Badge variant="outline">Cliente vinculado</Badge>}
                {selected.lead_id && <Badge variant="secondary">Lead temporário</Badge>}
              </div>
            </div>
            <div className="p-4 border-b space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Ações rápidas
              </div>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <FileText className="h-4 w-4 mr-2" /> Criar orçamento
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <ClipboardList className="h-4 w-4 mr-2" /> Criar OS
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Tag className="h-4 w-4 mr-2" /> Etiquetar
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Vínculos</div>
              <div className="text-sm space-y-2 text-muted-foreground">
                <div>Cliente: {selected.cliente_id ?? "não vinculado"}</div>
                <div>Lead: {selected.lead_id ?? "não vinculado"}</div>
                <div>OS: {selected.os_id ?? "não vinculada"}</div>
              </div>
            </div>
          </>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">Nenhuma conversa selecionada.</div>
        )}
      </Card>
    </div>
  );
}
