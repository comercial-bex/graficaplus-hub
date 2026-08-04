import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { Card, CardContent } from "@/components/ui/card";
import { casosDeUso } from "@/lib/system-map";
import { ShieldCheck, ArrowLeftRight, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/casos-de-uso")({
  head: () => ({
    meta: [
      { title: "Casos de uso — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Fluxo ponta a ponta do ERP: entrada, orçamento, OS, produção e entrega, com validações e transferências entre sistemas.",
      },
      { property: "og:title", content: "Casos de uso — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Etapas, validações e integrações do fluxo comercial e produtivo da Bex Print.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CasosDeUsoPage,
});

const tones = ["cyan", "magenta", "lime", "amber", "muted"] as const;

function CasosDeUsoPage() {
  return (
    <div>
      <SectionHeader
        breadcrumb="Documentação viva"
        title="Casos de uso do sistema"
        description="Entrada → Orçamento → OS → Produção → Entrega. Cada etapa lista onde ocorrem as validações e onde há transferência de dados entre módulos e sistemas externos."
      />

      {/* Trilha de etapas */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {casosDeUso.map((e, i) => (
          <div key={e.id} className="flex items-center gap-2">
            <a
              href={`#${e.id}`}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:border-[color:var(--bex-cyan)]/40"
            >
              <span className="font-mono text-[10px] text-muted-foreground mr-2">
                {String(i + 1).padStart(2, "0")}
              </span>
              {e.etapa}
            </a>
            {i < casosDeUso.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        ))}
      </div>

      <div className="space-y-6">
        {casosDeUso.map((etapa, i) => (
          <Card key={etapa.id} id={etapa.id} className="scroll-mt-20 overflow-hidden">
            <div className="h-[2px]" style={{ background: "var(--gradient-cmyk)" }} />
            <CardContent className="p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Etapa {String(i + 1).padStart(2, "0")}
                  </div>
                  <h2 className="text-xl font-black tracking-tight">{etapa.etapa}</h2>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{etapa.descricao}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {etapa.rotas.map((r) => (
                    <Link
                      key={r.url}
                      to={r.url}
                      className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      {r.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-[color:var(--bex-lime)]" />
                    Validações
                  </div>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {etapa.validacoes.map((v) => (
                      <li key={v} className="flex gap-2">
                        <span className="text-[color:var(--bex-lime)]">•</span>
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <ArrowLeftRight className="h-4 w-4 text-[color:var(--bex-cyan)]" />
                    Transferências entre sistemas
                  </div>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {etapa.transferencias.map((t) => (
                      <li key={t} className="flex gap-2">
                        <span className="text-[color:var(--bex-cyan)]">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-3">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    Entidades
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {etapa.entidades.map((e) => (
                      <code
                        key={e}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {e}
                      </code>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    <Users className="h-3 w-3" /> Perfis
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {etapa.perfis.map((p) => (
                      <StatusChip key={p} label={p} tone={tones[i % tones.length]} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    Permissões exigidas
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {etapa.permissoes.map((p) => (
                      <code
                        key={p}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {p}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
