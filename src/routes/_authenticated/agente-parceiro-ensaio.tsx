import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import {
  iniciarAgente, minimoCompleto, responder, resumo, verificarSilencio,
  type EstadoDoAgente, type MotivoDeTransferencia,
} from "@/domain/whatsapp/agente-parceiro";

export const Route = createFileRoute("/_authenticated/agente-parceiro-ensaio")({
  head: () => ({
    meta: [
      { title: "Ensaio do agente de parceiros — BEX PRINT OS" },
      { name: "description", content: "Teste o agente que cadastra parceiros pelo WhatsApp, sem enviar mensagens." },
    ],
  }),
  component: EnsaioDoAgenteDeParceiros,
});

type Fala = { de: "pessoa" | "agente" | "sistema"; texto: string };

const MOTIVO: Record<MotivoDeTransferencia, string> = {
  pediu_atendente: "A pessoa pediu atendente",
  assunto_da_equipe: "Assunto da equipe (preço, prazo, pagamento…)",
  midia: "Chegou áudio, imagem ou arquivo",
  ininteligivel: "Duas respostas sem entender",
  texto_bloqueado: "Resposta barrada pela trava",
};

const SITUACAO: Record<EstadoDoAgente["situacao"], string> = {
  coletando: "Coletando", minimo_completo: "Mínimo completo", enviado: "Enviado à equipe",
  saiu: "Saiu (não contatar)", transferido: "Com a equipe", pausado: "Pausado",
};

/** Ensaio: tudo acontece só nesta tela. Nada vai para o WhatsApp e nada é gravado. */
function EnsaioDoAgenteDeParceiros() {
  const [telefone, setTelefone] = useState("5596991234567");
  const [foraDoHorario, setForaDoHorario] = useState(false);
  const [estado, setEstado] = useState<EstadoDoAgente>(() => iniciarAgente("5596991234567").estado);
  const [falas, setFalas] = useState<Fala[]>(() => iniciarAgente("5596991234567").respostas.map((t) => ({ de: "agente" as const, texto: t })));
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState<MotivoDeTransferencia | null>(null);
  const [preCadastroCriado, setPreCadastroCriado] = useState(false);

  const agora = () => (foraDoHorario ? new Date("2026-11-15T13:00:00Z") : new Date(new Date().setUTCHours(13, 0, 0, 0) + 0));
  const diaUtil = () => {
    const d = agora();
    if (foraDoHorario) return d;
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };

  function recomecar(tel = telefone) {
    const i = iniciarAgente(tel);
    setEstado(i.estado);
    setFalas(i.respostas.map((t) => ({ de: "agente", texto: t })));
    setMotivo(null);
    setPreCadastroCriado(false);
  }

  function enviar(entrada: { tipo: "texto" | "midia"; texto?: string }) {
    const r = responder(estado, { ...entrada, agora: diaUtil() });
    setEstado(r.estado);
    if (r.transferir) setMotivo(r.transferir);
    if (r.criarPreCadastro) setPreCadastroCriado(true);
    setFalas((f) => [
      ...f,
      { de: "pessoa", texto: entrada.tipo === "midia" ? "[áudio]" : entrada.texto ?? "" },
      ...r.respostas.map((t) => ({ de: "agente" as const, texto: t })),
      ...(r.criarPreCadastro ? [{ de: "sistema" as const, texto: "Mínimo completo: aqui o pré-cadastro seria criado (no ensaio, nada é gravado)." }] : []),
    ]);
  }

  function silencio() {
    const r = verificarSilencio(estado, 31 * 60_000);
    setEstado(r.estado);
    setFalas((f) => [
      ...f,
      { de: "sistema", texto: "30 minutos sem resposta" },
      ...r.respostas.map((t) => ({ de: "agente" as const, texto: t })),
      ...(r.respostas.length === 0 ? [{ de: "sistema" as const, texto: r.estado.situacao === "pausado" ? "Conversa pausada; retoma de onde parou." : "Nada a fazer." }] : []),
    ]);
  }

  function baixar() {
    const linhas = falas.map((f) => `${f.de === "pessoa" ? "Pessoa" : f.de === "agente" ? "Agente" : "—"}: ${f.texto}`);
    const blob = new Blob([[...linhas, "", resumo(estado.ficha)].join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ensaio-agente-parceiro.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const parado = ["saiu", "transferido", "enviado"].includes(estado.situacao);
  const f = estado.ficha;
  const campos = useMemo(() => [
    { rotulo: "Aceite LGPD", valor: f.aceiteLgpdEm ? new Date(f.aceiteLgpdEm).toLocaleString("pt-BR") : null, obrigatorio: true },
    { rotulo: "Nome", valor: f.nome, obrigatorio: true },
    { rotulo: "WhatsApp do cadastro", valor: f.telefoneCadastro ? `${f.telefoneCadastro} ${f.telefoneConfirmado ? "(o mesmo da conversa)" : "(outro número)"}` : null, obrigatorio: true },
    { rotulo: "E-mail", valor: f.email, obrigatorio: true },
    { rotulo: "Empresa/marca", valor: f.empresa, respondido: estado.respondidos.includes("empresa") },
    { rotulo: "Ramo", valor: f.ramo ? (f.ramo === "outro" ? `outro${f.ramoOutro ? `: ${f.ramoOutro}` : ""}` : f.ramo) : null, respondido: estado.respondidos.includes("ramo") },
    { rotulo: "Cidade/UF", valor: f.cidade ? `${f.cidade}/${f.uf}` : null, respondido: estado.respondidos.includes("cidade") },
    { rotulo: "Instagram/site", valor: f.instagramOuSite, respondido: estado.respondidos.includes("instagram") },
    { rotulo: "CNPJ/CPF", valor: f.documento, respondido: estado.respondidos.includes("documento") },
    { rotulo: "Volume mensal", valor: f.volume, respondido: estado.respondidos.includes("volume") },
    { rotulo: "Promoções", valor: f.aceitaPromocoes == null ? null : `${f.aceitaPromocoes ? "Sim" : "Não"} · ${new Date(f.aceitePromocoesEm!).toLocaleString("pt-BR")}`, respondido: estado.respondidos.includes("promocoes") },
  ], [f, estado.respondidos]);

  return (
    <div className="space-y-4">
      <SectionHeader
        ajuda={dicaTela("/agente-parceiro-ensaio")}
        breadcrumb="Atendimento · WhatsApp"
        title="Ensaio do agente de parceiros"
        description="Converse como se fosse um interessado e veja a ficha ser preenchida. Nada sai pelo WhatsApp e nada é gravado."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Conversa simulada</CardTitle>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                Telefone da conversa
                <Input className="h-8 w-40 font-mono" value={telefone} onChange={(e) => setTelefone(e.target.value)} onBlur={() => recomecar()} aria-label="Telefone da conversa" />
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={foraDoHorario} onCheckedChange={setForaDoHorario} aria-label="Simular fora do horário" />
                Fora do horário
              </label>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-[460px] space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3" aria-live="polite">
              {falas.map((x, i) => (
                <div key={i} className={x.de === "pessoa" ? "flex justify-end" : x.de === "sistema" ? "flex justify-center" : "flex justify-start"}>
                  <div className={
                    x.de === "pessoa" ? "max-w-[80%] whitespace-pre-line rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : x.de === "sistema" ? "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                      : "max-w-[80%] whitespace-pre-line rounded-lg border bg-card px-3 py-2 text-sm"}>
                    {x.texto}
                  </div>
                </div>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!texto.trim()) return; enviar({ tipo: "texto", texto }); setTexto(""); }}>
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={parado ? "Conversa encerrada — recomece" : "Escreva como o interessado…"} disabled={parado} aria-label="Mensagem do interessado" />
              <Button type="submit" disabled={parado}>Enviar</Button>
            </form>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={parado} onClick={() => enviar({ tipo: "texto", texto: "SAIR" })}>SAIR</Button>
              <Button size="sm" variant="outline" disabled={parado} onClick={() => enviar({ tipo: "midia" })}>Áudio simulado</Button>
              <Button size="sm" variant="outline" disabled={parado} onClick={silencio}>Silêncio de 30 min</Button>
              <Button size="sm" variant="outline" onClick={baixar}>Baixar conversa</Button>
              <Button size="sm" variant="secondary" onClick={() => recomecar()}>Recomeçar</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">Ficha do pré-cadastro</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Passo: {estado.passo}</Badge>
              <Badge variant="outline">{SITUACAO[estado.situacao]}</Badge>
              <Badge variant="outline">Fonte: {estado.fonte}</Badge>
              {minimoCompleto(f) && <Badge>Mínimo completo</Badge>}
            </div>
            {preCadastroCriado && <p className="text-xs text-muted-foreground">O pré-cadastro seria criado agora; no ensaio nada é gravado.</p>}
            {motivo && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">Transferido: {MOTIVO[motivo]}</p>}
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {campos.map((c) => (
                <div key={c.rotulo} className="flex items-start justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">{c.rotulo}{c.obrigatorio && " *"}</dt>
                  <dd className="text-right">
                    {c.valor ? <span className="font-medium">{c.valor}</span>
                      : c.respondido ? <span className="text-muted-foreground">não informou</span>
                      : <span className="text-muted-foreground/60">vazio</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">* mínimo para valer como cadastro.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
