import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { brl, CartaoDoReembolso, EstadoDaLista } from "@/components/reembolsos/lista";
import { buscarReembolsos, CHAVE_DOS_REEMBOLSOS } from "@/components/reembolsos/dados";

/**
 * Os reembolsos de uma OS, na aba Financeiro dela: o que a equipe comprou por
 * fora para este trabalho. O aprovado já está nos custos reais acima (origem
 * "reembolso"); aqui aparece também o que ainda espera decisão.
 */
export function ReembolsosDaOS({ osId }: { osId: string }) {
  const q = useQuery({
    queryKey: [CHAVE_DOS_REEMBOLSOS, "da-os", osId],
    queryFn: () => buscarReembolsos({ osId }),
  });
  const lista = q.data ?? [];
  const valendo = lista.filter((r) => r.status === "aprovado" || r.status === "pago");
  const esperando = lista.filter((r) => r.status === "aguardando");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Reembolsos desta OS — {brl(valendo.reduce((n, r) => n + r.valor, 0))} aprovado
          {esperando.length > 0 && `, ${brl(esperando.reduce((n, r) => n + r.valor, 0))} esperando`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <EstadoDaLista
          carregando={q.isPending}
          erro={q.isError ? q.error : null}
          vazio={lista.length === 0}
          textoVazio="Ninguém pediu reembolso de compra para esta OS."
        >
          <ul className="space-y-2">
            {lista.map((r) => (
              <CartaoDoReembolso key={r.id} r={r} />
            ))}
          </ul>
        </EstadoDaLista>
        <p className="text-xs text-muted-foreground">
          Decidir e pagar fica em{" "}
          <Link to="/reembolsos" className="underline underline-offset-2">
            Financeiro › Reembolsos
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
