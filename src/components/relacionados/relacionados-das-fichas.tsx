import { useAuth } from "@/lib/auth-context";
import { getRoutePermissions } from "@/lib/permissions";
import {
  aplicarAcesso,
  elosDaOs,
  elosDoCliente,
  elosDoOrcamento,
  type DadosDaOs,
  type DadosDoOrcamento,
} from "@/domain/relacionados/elos";
import { RelacionadosDoRegistro } from "./relacionados-do-registro";
import {
  useConversaDoCliente,
  useContasDaOsLidas,
  useContasDoClienteLidas,
  useEntregasDaOs,
  useEnviosDoOrcamento,
  useOrcamentoDeOrigem,
  useOsGerada,
  useParceiroDoCliente,
  useProdutosDaOs,
} from "./usar-relacionados";

/**
 * A faixa "Relacionados" de cada ficha (23/11/2026, Onda 1 do diagnóstico). Cada ficha passa o registro que já carregou;
 * aqui se juntam as leituras que faltam, as regras do domínio e a permissão de quem olha.
 *
 * O link só aparece quando a pessoa abre a tela de destino: a mesma regra do menu (`getRoutePermissions`).
 */

function useAbre() {
  const { hasPermission } = useAuth();
  return (caminho: string) => (getRoutePermissions(caminho) ?? []).some(hasPermission);
}

export function RelacionadosDaOs({ osId, os }: { osId: string; os: DadosDaOs }) {
  const { canSeeFinancials, nivelDeVisao } = useAuth();
  const abre = useAbre();
  const orcamento = useOrcamentoDeOrigem(os.orcamento_id, nivelDeVisao);
  const produtos = useProdutosDaOs(osId, nivelDeVisao);
  const entregas = useEntregasDaOs(osId);
  const contas = useContasDaOsLidas(osId, canSeeFinancials);
  const elos = aplicarAcesso(elosDaOs({ osId, os, orcamento, produtos, entregas, contas }), abre);
  return <RelacionadosDoRegistro elos={elos} />;
}

export function RelacionadosDoOrcamento({ orcamentoId, orc }: { orcamentoId: string; orc: DadosDoOrcamento }) {
  const { hasPermission, nivelDeVisao } = useAuth();
  const abre = useAbre();
  const os = useOsGerada(orc.os_id, nivelDeVisao);
  const envios = useEnviosDoOrcamento(orcamentoId, hasPermission("orcamentos.read"));
  const conversa = useConversaDoCliente(orc.cliente_id, hasPermission("whatsapp.read"));
  const elos = aplicarAcesso(elosDoOrcamento({ orc, os, envios, conversa }), abre);
  return <RelacionadosDoRegistro elos={elos} />;
}

export function RelacionadosDoCliente({ clienteId }: { clienteId: string }) {
  const { canSeeFinancials, hasPermission } = useAuth();
  const abre = useAbre();
  const contas = useContasDoClienteLidas(clienteId, canSeeFinancials);
  const parceiro = useParceiroDoCliente(clienteId, hasPermission("parceiros.read"));
  const elos = aplicarAcesso(elosDoCliente({ contas, parceiro }), abre);
  return <RelacionadosDoRegistro elos={elos} />;
}
