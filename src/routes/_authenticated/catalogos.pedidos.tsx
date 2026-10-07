import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Button } from "@/components/ui/button";
import { dicaAcao } from "@/lib/dicas";
import { PedidosDeCotacao } from "@/components/catalogo/pedidos-de-cotacao";

export const Route = createFileRoute("/_authenticated/catalogos/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos de cotação — BEX PRINT OS" }] }),
  component: PedidosPage,
});

/**
 * Os pedidos de cotação que chegaram pelos links da vitrine: quem pediu,
 * quando e o quê. Quem vê o catálogo (catalogo.read) atende — é o vendedor
 * que responde ao cliente, pelo WhatsApp dele; nada sai daqui sozinho.
 */
function PedidosPage() {
  return (
    <div>
      <SectionHeader
        ajuda={dicaAcao("/catalogos", "pedidos")}
        breadcrumb="Print OS · Comercial · Catálogo de brindes"
        title="Pedidos de cotação"
        description="O que os clientes pediram pelos links da vitrine. Responda pelo WhatsApp e marque como atendido."
        actions={
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link to="/catalogos">
              <ChevronLeft className="mr-1 h-4 w-4" /> Loja
            </Link>
          </Button>
        }
      />
      <PedidosDeCotacao />
    </div>
  );
}
