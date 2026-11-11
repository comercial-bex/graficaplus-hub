import { Badge } from "@/components/ui/badge";
import { Dica } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { ehLeadParceiro } from "@/domain/crm/tipo-do-lead";

export function SeloParceiro({ tipo }: { tipo?: unknown }) {
  if (!ehLeadParceiro(tipo)) return null;
  return <Dica texto={dicaCampo("/funil", "parceiros")}>
    <Badge variant="outline" className="shrink-0 border-lead-parceiro bg-lead-parceiro-surface text-lead-parceiro font-medium">Parceiro</Badge>
  </Dica>;
}