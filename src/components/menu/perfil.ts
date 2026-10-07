import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

/** A ficha da pessoa logada, do jeito que o cartão Meus dados a lê. */
export type MinhaFicha = {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  avatar_url: string | null;
};

/**
 * Nome e foto de quem está logado, para o cabeçalho do menu.
 *
 * Mesma chave e mesma consulta do cartão Meus dados (src/components/
 * configuracoes/meus-dados-card.tsx): trocar a foto ou o nome lá invalida
 * ["meu-perfil", id] e o menu muda na hora. A foto é a URL assinada de longa
 * duração gravada em `usuarios.avatar_url` — a mesma que o Quadro de produção
 * usa direto na tag de imagem.
 */
export function usePerfilDoMenu() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  return useQuery({
    queryKey: ["meu-perfil", uid],
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<MinhaFicha | null> => {
      const { data, error } = await supabase
        .from("usuarios")
        .select("id, nome, email, telefone, avatar_url")
        .eq("id", uid as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MinhaFicha | null;
    },
  });
}

/** "Harison" de "Harison"; "Leonardo" de "Leonardo Pimentel de Almeida"; o e-mail até o @ quando não há nome. */
export function primeiroNome(
  nome: string | null | undefined,
  email: string | null | undefined,
): string {
  const limpo = (nome ?? "").trim();
  if (limpo) return limpo.split(/\s+/)[0];
  const doEmail = (email ?? "").split("@")[0];
  return doEmail ? doEmail.charAt(0).toUpperCase() + doEmail.slice(1) : "";
}

/** "HA" de "Harison"; "LA" de "Leonardo Pimentel de Almeida"; as 2 primeiras letras do e-mail sem nome. */
export function iniciais(
  nome: string | null | undefined,
  email: string | null | undefined,
): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 2).toUpperCase();
}
