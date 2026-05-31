import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  CreditCard,
  FileUp,
  Image,
  Lock,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatCurrency,
  getPublicPortalRecord,
  quoteTotal,
  type PublicLinkScope,
} from "@/lib/public-access";
import { submitPublicPortalAction, verifyPublicAccessToken } from "@/lib/public-access.server";

export const Route = createFileRoute("/publico/$token")({
  head: () => ({ meta: [{ title: "Portal do Cliente — BEX PRINT OS" }] }),
  component: PublicPortalPage,
});

function can(scopes: PublicLinkScope[] | undefined, scope: PublicLinkScope) {
  return Boolean(scopes?.includes(scope));
}

function PublicPortalPage() {
  const { token } = Route.useParams();
  const [notes, setNotes] = useState("");
  const [fileName, setFileName] = useState("");

  const verification = useQuery({
    queryKey: ["public-access", token],
    queryFn: () => verifyPublicAccessToken({ data: { token } }),
    retry: false,
  });

  const payload = verification.data?.valid ? verification.data.payload : undefined;
  const record = useMemo(
    () => (payload ? getPublicPortalRecord(payload.sub) : undefined),
    [payload],
  );
  const scopes = payload?.scopes;

  const actionMutation = useMutation({
    mutationFn: (
      action: "approve_quote" | "upload_file" | "approve_art" | "reject_art" | "upload_payment",
    ) => submitPublicPortalAction({ data: { token, action, notes, fileName } }),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message);
      toast.success(`${result.message} Protocolo: ${result.protocol}`);
      setNotes("");
      setFileName("");
    },
    onError: () => toast.error("Não foi possível enviar sua solicitação."),
  });

  if (verification.isLoading) {
    return (
      <PublicShell>
        <div className="text-center text-muted-foreground">Validando link seguro...</div>
      </PublicShell>
    );
  }

  if (!verification.data?.valid || !record) {
    return (
      <PublicShell>
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Link indisponível</AlertTitle>
          <AlertDescription>
            {verification.data?.reason ?? "Este link não pôde ser validado."}
          </AlertDescription>
        </Alert>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-emerald-700">
              <ShieldCheck className="h-4 w-4" /> Link assinado e temporário validado
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Portal do Cliente</h1>
            <p className="text-muted-foreground">
              {record.quote.cliente} · Orçamento #{record.quote.numero} · OS #{record.order.numero}
            </p>
          </div>
          <Badge variant="outline" className="w-fit gap-1">
            <Clock className="h-3 w-3" /> Expira em{" "}
            {new Date(payload.exp * 1000).toLocaleDateString("pt-BR")}
          </Badge>
        </div>

        <Tabs defaultValue="orcamento" className="space-y-4">
          <TabsList className="grid h-auto grid-cols-2 md:grid-cols-6">
            <TabsTrigger value="orcamento">Orçamento</TabsTrigger>
            <TabsTrigger value="arquivo">Arquivo</TabsTrigger>
            <TabsTrigger value="arte">Arte</TabsTrigger>
            <TabsTrigger value="pagamento">Pagamento</TabsTrigger>
            <TabsTrigger value="status">Status OS</TabsTrigger>
            <TabsTrigger value="ajuda">Ajuda</TabsTrigger>
          </TabsList>

          <TabsContent value="orcamento">
            <QuoteCard
              record={record}
              onApprove={() => actionMutation.mutate("approve_quote")}
              disabled={!can(scopes, "quote:approve") || actionMutation.isPending}
            />
          </TabsContent>
          <TabsContent value="arquivo">
            <UploadCard
              title="Enviar arquivo de produção"
              description="Anexe ou informe o nome do arquivo final para sua OS."
              icon={<FileUp className="h-5 w-5" />}
              fileName={fileName}
              setFileName={setFileName}
              notes={notes}
              setNotes={setNotes}
              onSubmit={() => actionMutation.mutate("upload_file")}
              disabled={!can(scopes, "file:upload") || actionMutation.isPending}
            />
          </TabsContent>
          <TabsContent value="arte">
            <ArtCard
              record={record}
              notes={notes}
              setNotes={setNotes}
              onApprove={() => actionMutation.mutate("approve_art")}
              onReject={() => actionMutation.mutate("reject_art")}
              disabled={!can(scopes, "art:review") || actionMutation.isPending}
            />
          </TabsContent>
          <TabsContent value="pagamento">
            <UploadCard
              title="Enviar comprovante"
              description="Informe os dados do comprovante para liberação financeira."
              icon={<CreditCard className="h-5 w-5" />}
              fileName={fileName}
              setFileName={setFileName}
              notes={notes}
              setNotes={setNotes}
              onSubmit={() => actionMutation.mutate("upload_payment")}
              disabled={!can(scopes, "payment:upload") || actionMutation.isPending}
            />
          </TabsContent>
          <TabsContent value="status">
            <StatusCard record={record} />
          </TabsContent>
          <TabsContent value="ajuda">
            <HelpCard />
          </TabsContent>
        </Tabs>
      </div>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 p-4 md:p-8">
      <div className="mb-6 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
        <Lock className="h-4 w-4" /> BEX PRINT OS — acesso externo seguro
      </div>
      {children}
    </div>
  );
}

function QuoteCard({
  record,
  onApprove,
  disabled,
}: {
  record: ReturnType<typeof getPublicPortalRecord>;
  onApprove: () => void;
  disabled: boolean;
}) {
  const total = quoteTotal(record.quote.itens);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{record.quote.titulo}</CardTitle>
        <CardDescription>
          Validade: {new Date(record.quote.validade).toLocaleDateString("pt-BR")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-lg border">
          {record.quote.itens.map((item) => (
            <div
              key={item.descricao}
              className="grid grid-cols-4 gap-3 border-b p-3 text-sm last:border-b-0"
            >
              <div className="col-span-2 font-medium">{item.descricao}</div>
              <div>{item.quantidade} un.</div>
              <div className="text-right">
                {formatCurrency(item.quantidade * item.valorUnitario)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted p-4 text-lg font-semibold">
          <span>Total</span>
          <span>{formatCurrency(total)}</span>
        </div>
        <p className="text-sm text-muted-foreground">{record.quote.observacoes}</p>
        <Button onClick={onApprove} disabled={disabled} className="w-full md:w-auto">
          <Check className="mr-2 h-4 w-4" /> Aprovar orçamento
        </Button>
      </CardContent>
    </Card>
  );
}

function UploadCard(props: {
  title: string;
  description: string;
  icon: ReactNode;
  fileName: string;
  setFileName: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {props.icon}
          {props.title}
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Arquivo</Label>
          <Input
            type="file"
            onChange={(event) => props.setFileName(event.target.files?.[0]?.name ?? "")}
          />
        </div>
        <div className="space-y-2">
          <Label>Nome/link do arquivo</Label>
          <Input
            value={props.fileName}
            onChange={(event) => props.setFileName(event.target.value)}
            placeholder="ex.: arte-final.pdf ou link do Drive"
          />
        </div>
        <div className="space-y-2">
          <Label>Observações</Label>
          <Textarea
            value={props.notes}
            onChange={(event) => props.setNotes(event.target.value)}
            placeholder="Informações importantes para nossa equipe"
          />
        </div>
        <Button onClick={props.onSubmit} disabled={props.disabled || !props.fileName}>
          <FileUp className="mr-2 h-4 w-4" /> Enviar com segurança
        </Button>
      </CardContent>
    </Card>
  );
}

function ArtCard({
  record,
  notes,
  setNotes,
  onApprove,
  onReject,
  disabled,
}: {
  record: ReturnType<typeof getPublicPortalRecord>;
  notes: string;
  setNotes: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <div className="flex aspect-video items-center justify-center rounded-t-xl border-b bg-gradient-to-br from-violet-500/20 to-blue-500/20">
        <Image className="h-16 w-16 text-muted-foreground/50" />
      </div>
      <CardHeader>
        <CardTitle>Arte v{record.art.versao}</CardTitle>
        <CardDescription>Enviada em {record.art.enviadaEm}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <MessageSquare className="h-4 w-4" />
          <AlertTitle>Revise antes de aprovar</AlertTitle>
          <AlertDescription>{record.art.observacoes}</AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Label>Comentários para ajustes</Label>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Descreva ajustes caso reprove a arte"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onApprove} disabled={disabled}>
            <Check className="mr-2 h-4 w-4" /> Aprovar arte
          </Button>
          <Button onClick={onReject} disabled={disabled} variant="destructive">
            <X className="mr-2 h-4 w-4" /> Reprovar arte
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({ record }: { record: ReturnType<typeof getPublicPortalRecord> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="h-5 w-5" /> OS #{record.order.numero}
        </CardTitle>
        <CardDescription>
          {record.order.titulo} · previsão{" "}
          {new Date(record.order.previsao).toLocaleDateString("pt-BR")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Status atual</div>
          <div className="text-xl font-semibold">{record.order.status}</div>
          <div className="text-sm text-muted-foreground">
            Responsável: {record.order.responsavel}
          </div>
        </div>
        <div className="space-y-3">
          {record.order.steps.map((step) => (
            <div key={step.label} className="flex gap-3">
              <div
                className={`mt-1 h-3 w-3 rounded-full ${step.status === "done" ? "bg-emerald-500" : step.status === "current" ? "bg-blue-500" : "bg-muted"}`}
              />
              <div>
                <div className="font-medium">{step.label}</div>
                <div className="text-sm text-muted-foreground">{step.description}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HelpCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Precisa de ajuda?</CardTitle>
        <CardDescription>
          Se algo estiver incorreto, fale com nossa equipe pelo WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/login">Sou da equipe BEX PRINT OS</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
