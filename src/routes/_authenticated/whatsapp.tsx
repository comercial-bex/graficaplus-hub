/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Send, Paperclip, FileText, ClipboardList, User, Tag } from "lucide-react";
import { db, formatDateTime } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — BEX PRINT OS" }] }),
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const { data: conversas = [] } = useQuery({
    queryKey: ["whatsapp-conversas"],
    queryFn: async () => {
      const { data, error } = await db
        .from("whatsapp_conversas")
        .select("*")
        .order("ultima_interacao", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!selectedId && conversas[0]) setSelectedId(conversas[0].id);
  }, [conversas, selectedId]);
  const selected = conversas.find((c: any) => c.id === selectedId) ?? conversas[0];
  const { data: mensagens = [] } = useQuery({
    queryKey: ["whatsapp-mensagens", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("whatsapp_mensagens")
        .select("*")
        .eq("conversa_id", selected.id)
        .order("enviada_em");
      if (error) throw error;
      return data;
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("whatsapp_mensagens")
        .insert({ conversa_id: selected.id, direcao: "out", texto });
      if (error) throw error;
      await db
        .from("whatsapp_conversas")
        .update({
          ultima_mensagem: texto,
          ultima_interacao: new Date().toISOString(),
          nao_lidas: 0,
        })
        .eq("id", selected.id);
    },
    onSuccess: () => {
      setTexto("");
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens", selected?.id] });
      qc.invalidateQueries({ queryKey: ["whatsapp-conversas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("whatsapp_conversas").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-conversas"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!selected)
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Nenhuma conversa cadastrada no Supabase
      </Card>
    );

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
          {conversas.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors ${selected.id === c.id ? "bg-muted" : ""}`}
            >
              <div className="flex items-start gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{c.nome[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm truncate">{c.nome}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDateTime(c.ultima_interacao)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.ultima_mensagem || "Sem mensagens"}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] py-0">
                      {c.etiqueta || "Sem etiqueta"}
                    </Badge>
                    {c.nao_lidas > 0 && (
                      <Badge className="text-[10px] py-0 bg-emerald-600 hover:bg-emerald-600">
                        {c.nao_lidas}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="col-span-6 flex flex-col overflow-hidden">
        <div className="p-3 border-b flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{selected.nome[0]}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{selected.nome}</div>
            <div className="text-xs text-muted-foreground">{selected.numero}</div>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3 bg-muted/20">
          {mensagens.map((m: any) => (
            <div
              key={m.id}
              className={`flex ${m.direcao === "out" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] rounded-lg p-2.5 text-sm ${m.direcao === "out" ? "bg-emerald-600 text-white" : "bg-card border"}`}
              >
                <div>{m.texto}</div>
                <div
                  className={`text-[10px] mt-1 ${m.direcao === "out" ? "text-emerald-50" : "text-muted-foreground"}`}
                >
                  {formatDateTime(m.enviada_em)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            placeholder="Digite uma mensagem..."
            className="flex-1"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <Button
            size="icon"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => send.mutate()}
            disabled={!texto}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>
      <Card className="col-span-3 flex flex-col overflow-auto">
        <div className="p-4 border-b">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Cliente</div>
          <div className="flex items-center gap-2 font-medium">
            <User className="h-4 w-4" /> {selected.nome}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{selected.numero}</div>
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
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => update.mutate({ id: selected.id, changes: { etiqueta: "Atendimento" } })}
          >
            <Tag className="h-4 w-4 mr-2" /> Editar etiqueta
          </Button>
          <Button
            size="sm"
            className="w-full"
            onClick={() => update.mutate({ id: selected.id, changes: { nao_lidas: 0 } })}
          >
            Concluir atendimento
          </Button>
        </div>
      </Card>
    </div>
  );
}
