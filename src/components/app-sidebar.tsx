import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  linkDoTopo,
  menuDaPessoa,
  paginasDaBusca,
  podeAbrirRota,
  type ContagemDoMenu,
} from "@/lib/menu";
import { useContagensDoMenu } from "@/components/menu/contagens";
import { usePerfilDoMenu } from "@/components/menu/perfil";
import { MenuLateral } from "@/components/menu/menu-lateral";

/**
 * O menu lateral da equipe: a árvore por áreas (`src/lib/menu.ts`) filtrada
 * pelo que a pessoa abre, desenhada como trilho de módulos + painel.
 *
 * A permissão de cada item vem do mapa de rotas, não de um campo próprio:
 * enquanto eram duas listas, o menu mostrava link que o guarda barrava (e
 * escondia link que o guarda deixava passar). Item sem rota mapeada fica oculto
 * porque o guarda é deny-by-default e ele abriria em erro.
 */
export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, hasPermission, signOut } = useAuth();
  const perfil = usePerfilDoMenu();

  const podeAbrir = (url: string) => podeAbrirRota(url, hasPermission);
  const areas = menuDaPessoa(podeAbrir, hasPermission);

  // Só pergunta pelas contagens dos itens que a pessoa vê.
  const pedidas = new Set<ContagemDoMenu>();
  for (const area of areas) {
    for (const sub of area.subgrupos) {
      for (const i of sub.itens) if (i.badge) pedidas.add(i.badge);
    }
  }
  const contagens = useContagensDoMenu(pedidas);

  return (
    <MenuLateral
      areas={areas}
      topo={linkDoTopo(podeAbrir)}
      paginasDaBusca={paginasDaBusca(areas, podeAbrir)}
      pathname={pathname}
      pessoa={{
        nome: perfil.data?.nome ?? null,
        email: perfil.data?.email ?? user?.email ?? null,
        foto: perfil.data?.avatar_url ?? null,
      }}
      contagens={contagens}
      aoEscolherNaBusca={(url) => navigate({ to: url })}
      aoSair={() => signOut()}
    />
  );
}
