import { Component, type ReactNode } from "react";

/**
 * A rede de proteção da faixa "Relacionados" (23/11/2026). A faixa entra nas três fichas mais usadas (OS, orçamento e
 * cliente); uma exceção inesperada ao montá-la não pode levar a ficha inteira junto (o projeto só tem `errorComponent` por
 * rota, que troca a página toda). Se algo falhar, a faixa vira uma nota curta que DIZ que não carregou (erro diz que falhou,
 * não some em silêncio) e o resto da ficha continua como estava.
 */
export class FronteiraDaFaixa extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <p
        role="status"
        className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
        data-testid="relacionados-falhou"
      >
        Não foi possível montar a faixa de relacionados. O restante da ficha não foi afetado.
      </p>
    );
  }
}
