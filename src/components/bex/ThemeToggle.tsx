import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/bex/Dica";

type Tema = "light" | "dark";

const CHAVE_TEMA = "bexprint:tema";

function temaAtual(): Tema {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  raiz.classList.toggle("dark", tema === "dark");
  raiz.style.colorScheme = tema;
  const cor = tema === "dark" ? "#050506" : "#F7F9FC";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cor);
  window.localStorage.setItem(CHAVE_TEMA, tema);
}

/** Alterna somente a área de conteúdo; os tokens da barra lateral são sempre escuros. */
export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>("dark");

  useEffect(() => setTema(temaAtual()), []);

  const proximoTema: Tema = tema === "dark" ? "light" : "dark";
  const rotulo = proximoTema === "dark" ? "Usar tema escuro" : "Usar tema claro";

  return (
    <Dica texto={rotulo} lado="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={rotulo}
        onClick={() => {
          aplicarTema(proximoTema);
          setTema(proximoTema);
        }}
        className="h-9 w-9 rounded-full border border-border bg-background/70 text-muted-foreground shadow-sm hover:text-foreground"
      >
        {tema === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </Dica>
  );
}