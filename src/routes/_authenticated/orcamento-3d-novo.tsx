import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calculadora3D } from "@/components/impressao3d/calculadora-3d";

/**
 * A porta antiga do orçamento 3D (/orcamento-3d-novo). Desde 27/10/2026 a peça 3D é um
 * item do orçamento comum: esta tela cria o orçamento, grava a peça como item e leva a
 * pessoa para /orcamentos/<id>, o mesmo lugar de qualquer orçamento.
 */
export const Route = createFileRoute("/_authenticated/orcamento-3d-novo")({
  head: () => ({ meta: [{ title: "Novo orçamento 3D — BEX PRINT OS" }] }),
  component: NovoOrcamento3D,
});

function NovoOrcamento3D() {
  const navigate = useNavigate();
  return (
    <Calculadora3D
      modo="novo-orcamento"
      orcamentoId={null}
      clienteId={null}
      onSalvo={(r) => navigate({ to: "/orcamentos/$id", params: { id: r.orcamentoId } })}
    />
  );
}
