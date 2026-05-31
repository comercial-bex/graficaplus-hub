/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Bot,
  GitBranch,
  Search,
  Send,
  Paperclip,
  FileText,
  ClipboardList,
  User,
  Tag,
} from "lucide-react";
import { conversasWhatsapp } from "@/lib/mock-data";
import { detectsHumanHandoff, getWhatsAppBotTransition, whatsappBotFlow } from "@/lib/whatsapp-bot";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — BEX PRINT OS" }] }),
  component: WhatsAppPage,
});

const mensagensMock = [
  { id: 1, dir: "in", txt: "Bom dia, gostaria de um orçamento de banner.", hora: "10:12" },
  { id: 2, dir: "out", txt: "Bom dia! Claro, qual a medida e quantidade?", hora: "10:15" },
  { id: 3, dir: "in", txt: "2m x 1m, 5 unidades, com ilhós.", hora: "10:17" },
  {
    id: 4,
    dir: "out",
    txt: "Perfeito. Posso preparar o orçamento agora. Tem prazo desejado?",
    hora: "10:18",
  },
  { id: 5, dir: "in", txt: "Para sexta-feira se possível.", hora: "10:20" },
];

function WhatsAppPage() {
  const [selected, setSelected] = useState(conversasWhatsapp[0]);
  const [botPreview, setBotPreview] = useState("Preciso falar com alguém sobre meu pagamento");
  const botTransition = getWhatsAppBotTransition(botPreview);

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
                      {c.etiqueta}
                    </Badge>
                    {c.naoLidas > 0 && (
                      <Badge className="text-[10px] py-0 bg-emerald-600 hover:bg-emerald-600">
                        {c.naoLidas}
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
          {mensagensMock.map((m) => (
            <div key={m.id} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[70%] rounded-lg p-2.5 text-sm ${
                  m.dir === "out" ? "bg-emerald-600 text-white" : "bg-card border"
                }`}
              >
                <div>{m.txt}</div>
                <div
                  className={`text-[10px] mt-1 ${m.dir === "out" ? "text-emerald-50" : "text-muted-foreground"}`}
                >
                  {m.hora}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input placeholder="Digite uma mensagem..." className="flex-1" />
          <Button size="icon" className="bg-emerald-600 hover:bg-emerald-700">
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
          <Button variant="outline" size="sm" className="w-full justify-start">
            <Tag className="h-4 w-4 mr-2" /> Etiquetar
          </Button>
        </div>
        <div className="p-4 space-y-3 border-b">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Histórico</div>
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span>OS-1042</span>
              <Badge variant="outline">Em produção</Badge>
            </div>
            <div className="flex justify-between">
              <span>OS-1031</span>
              <Badge variant="outline">Concluído</Badge>
            </div>
            <div className="flex justify-between">
              <span>Orç #245</span>
              <Badge variant="outline">Enviado</Badge>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3 border-b">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Bot className="h-4 w-4" /> Bot WhatsApp
          </div>
          <Input
            value={botPreview}
            onChange={(e) => setBotPreview(e.target.value)}
            placeholder="Teste uma mensagem do cliente"
          />
          <div className="rounded-lg border p-3 text-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">
                Estado: {botTransition.state.replace(/_/g, " ")}
              </span>
              {botTransition.humanHandoff && (
                <Badge className="bg-amber-600 hover:bg-amber-600">Transferir</Badge>
              )}
            </div>
            <p className="text-muted-foreground">{botTransition.reply}</p>
            <div className="flex flex-wrap gap-1">
              {botTransition.quickReplies.map((reply) => (
                <Badge key={reply} variant="outline" className="text-[10px]">
                  {reply}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Detecção humana:{" "}
            {detectsHumanHandoff(botPreview)
              ? "atendente/humano/suporte/pessoa/falar com alguém encontrado"
              : "nenhum gatilho humano"}
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <GitBranch className="h-4 w-4" /> Estados configurados
          </div>
          <div className="space-y-2">
            {whatsappBotFlow.map((step) => (
              <div key={step.state} className="rounded-lg border p-2 text-xs">
                <div className="font-medium">{step.label}</div>
                <div className="text-muted-foreground">Gatilhos: {step.trigger}</div>
                <div className="text-muted-foreground">Ação: {step.next}</div>
              </div>
            ))}
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
