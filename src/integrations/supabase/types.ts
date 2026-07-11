export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      apontamentos_producao: {
        Row: {
          created_at: string
          etapa: string
          finalizado_em: string | null
          id: string
          iniciado_em: string
          maquina_id: string | null
          observacoes: string | null
          operador_id: string | null
          os_id: string | null
          quantidade: number
          setor: string | null
        }
        Insert: {
          created_at?: string
          etapa: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          maquina_id?: string | null
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          quantidade?: number
          setor?: string | null
        }
        Update: {
          created_at?: string
          etapa?: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          maquina_id?: string | null
          observacoes?: string | null
          operador_id?: string | null
          os_id?: string | null
          quantidade?: number
          setor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apontamentos_producao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "apontamentos_producao_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      aprovacoes: {
        Row: {
          aprovado: boolean
          arquivo_id: string | null
          canal: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id: string | null
          created_at: string
          id: string
          observacao: string | null
          orcamento_id: string | null
          os_id: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id: string | null
        }
        Insert: {
          aprovado: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Update: {
          aprovado?: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aprovacoes_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_cliente_contato_id_fkey"
            columns: ["cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "aprovacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivos: {
        Row: {
          aprovado_por: string | null
          ativo: boolean
          caminho: string
          cliente_id: string | null
          conversa_id: string | null
          created_at: string
          data_aprovacao: string | null
          enviado_por: string | null
          final_producao: boolean
          id: string
          mime_type: string | null
          nome: string
          observacao: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_arquivo"]
          substituido_por: string | null
          tamanho_bytes: number | null
          tarefa_id: string | null
          tipo: Database["public"]["Enums"]["tipo_arquivo"]
          url: string | null
          versao: number
        }
        Insert: {
          aprovado_por?: string | null
          ativo?: boolean
          caminho: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          data_aprovacao?: string | null
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome: string
          observacao?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Update: {
          aprovado_por?: string | null
          ativo?: boolean
          caminho?: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          data_aprovacao?: string | null
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome?: string
          observacao?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "arquivos_substituido_por_fkey"
            columns: ["substituido_por"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      automacao_execucoes: {
        Row: {
          automacao_id: string
          contexto: Json
          created_at: string
          dedupe_key: string
          entidade: string
          entidade_id: string | null
          erro: string | null
          gatilho: Database["public"]["Enums"]["automacao_gatilho"]
          id: string
          payload: Json
          processado_em: string | null
          resposta: Json | null
          scheduled_at: string
          status: Database["public"]["Enums"]["automacao_execucao_status"]
          tentativas: number
          updated_at: string
        }
        Insert: {
          automacao_id: string
          contexto?: Json
          created_at?: string
          dedupe_key: string
          entidade: string
          entidade_id?: string | null
          erro?: string | null
          gatilho: Database["public"]["Enums"]["automacao_gatilho"]
          id?: string
          payload?: Json
          processado_em?: string | null
          resposta?: Json | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["automacao_execucao_status"]
          tentativas?: number
          updated_at?: string
        }
        Update: {
          automacao_id?: string
          contexto?: Json
          created_at?: string
          dedupe_key?: string
          entidade?: string
          entidade_id?: string | null
          erro?: string | null
          gatilho?: Database["public"]["Enums"]["automacao_gatilho"]
          id?: string
          payload?: Json
          processado_em?: string | null
          resposta?: Json | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["automacao_execucao_status"]
          tentativas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacao_execucoes_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "automacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      automacoes: {
        Row: {
          acao: Database["public"]["Enums"]["automacao_acao"]
          ativo: boolean
          condicao: Json
          cooldown_segundos: number
          created_at: string
          created_by: string | null
          delay_segundos: number
          gatilho: Database["public"]["Enums"]["automacao_gatilho"]
          id: string
          nome: string
          payload: Json
          updated_at: string
        }
        Insert: {
          acao?: Database["public"]["Enums"]["automacao_acao"]
          ativo?: boolean
          condicao?: Json
          cooldown_segundos?: number
          created_at?: string
          created_by?: string | null
          delay_segundos?: number
          gatilho: Database["public"]["Enums"]["automacao_gatilho"]
          id?: string
          nome: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          acao?: Database["public"]["Enums"]["automacao_acao"]
          ativo?: boolean
          condicao?: Json
          cooldown_segundos?: number
          created_at?: string
          created_by?: string | null
          delay_segundos?: number
          gatilho?: Database["public"]["Enums"]["automacao_gatilho"]
          id?: string
          nome?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automacoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatos: {
        Row: {
          cargo: string | null
          cliente_id: string
          created_at: string
          email: string | null
          id: string
          nome: string
          principal: boolean
          telefone: string | null
        }
        Insert: {
          cargo?: string | null
          cliente_id: string
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          principal?: boolean
          telefone?: string | null
        }
        Update: {
          cargo?: string | null
          cliente_id?: string
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          principal?: boolean
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          cep: string | null
          cidade: string | null
          created_at: string
          created_by: string | null
          documento: string | null
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          logo_url: string | null
          nome: string
          observacoes: string | null
          razao_social: string | null
          telefone: string | null
          telefone_normalizado: string | null
          tipo: Database["public"]["Enums"]["tipo_cliente"]
          updated_at: string
          vendedor_id: string | null
        }
        Insert: {
          ativo?: boolean
          cep?: string | null
          cidade?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          observacoes?: string | null
          razao_social?: string | null
          telefone?: string | null
          telefone_normalizado?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          vendedor_id?: string | null
        }
        Update: {
          ativo?: boolean
          cep?: string | null
          cidade?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          observacoes?: string | null
          razao_social?: string | null
          telefone?: string | null
          telefone_normalizado?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comentarios_tarefa: {
        Row: {
          autor_id: string | null
          created_at: string
          id: string
          tarefa_id: string
          texto: string
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          id?: string
          tarefa_id: string
          texto: string
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          id?: string
          tarefa_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_tarefa_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_tarefa_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas_whatsapp: {
        Row: {
          aberta_em: string
          atendente_id: string | null
          cliente_id: string | null
          contato_nome: string
          created_at: string
          etiqueta: string | null
          fechada_em: string | null
          id: string
          status: string
          telefone: string
          ultima_mensagem_em: string | null
          updated_at: string
        }
        Insert: {
          aberta_em?: string
          atendente_id?: string | null
          cliente_id?: string | null
          contato_nome: string
          created_at?: string
          etiqueta?: string | null
          fechada_em?: string | null
          id?: string
          status?: string
          telefone: string
          ultima_mensagem_em?: string | null
          updated_at?: string
        }
        Update: {
          aberta_em?: string
          atendente_id?: string | null
          cliente_id?: string | null
          contato_nome?: string
          created_at?: string
          etiqueta?: string | null
          fechada_em?: string | null
          id?: string
          status?: string
          telefone?: string
          ultima_mensagem_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversas_whatsapp_atendente_id_fkey"
            columns: ["atendente_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_whatsapp_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      custos_os: {
        Row: {
          categoria: string | null
          created_at: string
          data: string
          descricao: string
          id: string
          os_id: string
          registrado_por: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          data?: string
          descricao: string
          id?: string
          os_id: string
          registrado_por?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          os_id?: string
          registrado_por?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "custos_os_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_gerados: {
        Row: {
          caminho: string
          created_at: string
          gerado_por: string | null
          id: string
          numero: number | null
          referencia_id: string
          tamanho_bytes: number | null
          tipo: string
          variante: string
        }
        Insert: {
          caminho: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id: string
          tamanho_bytes?: number | null
          tipo: string
          variante?: string
        }
        Update: {
          caminho?: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id?: string
          tamanho_bytes?: number | null
          tipo?: string
          variante?: string
        }
        Relationships: []
      }
      entregas_instalacoes: {
        Row: {
          created_at: string
          data_agendada: string | null
          data_realizada: string | null
          endereco: string | null
          id: string
          instalador_id: string | null
          observacoes: string | null
          os_id: string | null
          status: string
          tipo: string
        }
        Insert: {
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          id?: string
          instalador_id?: string | null
          observacoes?: string | null
          os_id?: string | null
          status?: string
          tipo?: string
        }
        Update: {
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          id?: string
          instalador_id?: string | null
          observacoes?: string | null
          os_id?: string | null
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "entregas_instalacoes_instalador_id_fkey"
            columns: ["instalador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      item_os_custos: {
        Row: {
          custo_unitario: number
          item_os_id: string
          updated_at: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          custo_unitario?: number
          item_os_id: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          custo_unitario?: number
          item_os_id?: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_os_custos_item_os_id_fkey"
            columns: ["item_os_id"]
            isOneToOne: true
            referencedRelation: "itens_os_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_os: {
        Row: {
          created_at: string
          custo_unitario: number
          descricao: string
          id: string
          ordem: number
          os_id: string
          produto_id: string | null
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          descricao: string
          id?: string
          ordem?: number
          os_id: string
          produto_id?: string | null
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          descricao?: string
          id?: string
          ordem?: number
          os_id?: string
          produto_id?: string | null
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          cliente_id: string | null
          created_at: string
          email: string | null
          id: string
          interesse: string | null
          nome: string
          observacoes: string | null
          origem: string
          responsavel_id: string | null
          status: string
          telefone: string | null
          telefone_normalizado: string | null
          temporario: boolean
          updated_at: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          interesse?: string | null
          nome: string
          observacoes?: string | null
          origem?: string
          responsavel_id?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          temporario?: boolean
          updated_at?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          interesse?: string | null
          nome?: string
          observacoes?: string | null
          origem?: string
          responsavel_id?: string | null
          status?: string
          telefone?: string | null
          telefone_normalizado?: string | null
          temporario?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_auditoria: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          entidade: string
          entidade_id: string | null
          id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          entidade: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          entidade?: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      manutencoes: {
        Row: {
          created_at: string
          custo: number
          data_conclusao: string | null
          data_prevista: string | null
          id: string
          maquina_id: string | null
          maquina_nome: string | null
          observacoes: string | null
          status: string
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo?: number
          data_conclusao?: string | null
          data_prevista?: string | null
          id?: string
          maquina_id?: string | null
          maquina_nome?: string | null
          observacoes?: string | null
          status?: string
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo?: number
          data_conclusao?: string | null
          data_prevista?: string | null
          id?: string
          maquina_id?: string | null
          maquina_nome?: string | null
          observacoes?: string | null
          status?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manutencoes_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manutencoes_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
        ]
      }
      maquinas: {
        Row: {
          ativa: boolean
          created_at: string
          id: string
          nome: string
          tipo: string | null
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
          tipo?: string | null
        }
        Update: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
          tipo?: string | null
        }
        Relationships: []
      }
      maquinas_agenda: {
        Row: {
          created_at: string
          fim: string
          id: string
          inicio: string
          maquina_id: string
          observacoes: string | null
          os_id: string | null
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fim: string
          id?: string
          inicio: string
          maquina_id: string
          observacoes?: string | null
          os_id?: string | null
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fim?: string
          id?: string
          inicio?: string
          maquina_id?: string
          observacoes?: string | null
          os_id?: string | null
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maquinas_agenda_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "maquinas_agenda_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      materiais: {
        Row: {
          created_at: string
          custo_unitario: number | null
          estoque: number
          estoque_minimo: number
          id: string
          nome: string
          unidade: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          estoque_minimo?: number
          id?: string
          nome: string
          unidade?: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          estoque_minimo?: number
          id?: string
          nome?: string
          unidade?: string
        }
        Relationships: []
      }
      material_custos: {
        Row: {
          custo_unitario: number | null
          material_id: string
          updated_at: string
        }
        Insert: {
          custo_unitario?: number | null
          material_id: string
          updated_at?: string
        }
        Update: {
          custo_unitario?: number | null
          material_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_custos_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: true
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens_whatsapp: {
        Row: {
          conversa_id: string
          created_at: string
          direcao: string
          enviada_em: string
          id: string
          texto: string | null
          usuario_id: string | null
        }
        Insert: {
          conversa_id: string
          created_at?: string
          direcao: string
          enviada_em?: string
          id?: string
          texto?: string | null
          usuario_id?: string | null
        }
        Update: {
          conversa_id?: string
          created_at?: string
          direcao?: string
          enviada_em?: string
          id?: string
          texto?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_whatsapp_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_whatsapp_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "rel_whatsapp_conversas_abertas"
            referencedColumns: ["conversa_id"]
          },
          {
            foreignKeyName: "mensagens_whatsapp_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "rel_whatsapp_tempo_medio_resposta"
            referencedColumns: ["conversa_id"]
          },
          {
            foreignKeyName: "mensagens_whatsapp_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes_estoque: {
        Row: {
          created_at: string
          id: string
          material_id: string
          observacao: string | null
          os_id: string | null
          quantidade: number
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          observacao?: string | null
          os_id?: string | null
          quantidade: number
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          observacao?: string | null
          os_id?: string | null
          quantidade?: number
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ocorrencias: {
        Row: {
          created_at: string
          custo: number
          custo_real: number
          descricao: string
          id: string
          os_id: string | null
          registrado_por: string | null
          resolvida: boolean
          resolvida_em: string | null
          retrabalho: boolean
          setor: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo?: number
          custo_real?: number
          descricao: string
          id?: string
          os_id?: string | null
          registrado_por?: string | null
          resolvida?: boolean
          resolvida_em?: string | null
          retrabalho?: boolean
          setor?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo?: number
          custo_real?: number
          descricao?: string
          id?: string
          os_id?: string | null
          registrado_por?: string | null
          resolvida?: boolean
          resolvida_em?: string | null
          retrabalho?: boolean
          setor?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "ocorrencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_custos: {
        Row: {
          custo_estimado: number
          desconto_percentual: number
          margem_estimada: number | null
          orcamento_id: string
          updated_at: string
          valor_subtotal: number
          valor_total: number
        }
        Insert: {
          custo_estimado?: number
          desconto_percentual?: number
          margem_estimada?: number | null
          orcamento_id: string
          updated_at?: string
          valor_subtotal?: number
          valor_total?: number
        }
        Update: {
          custo_estimado?: number
          desconto_percentual?: number
          margem_estimada?: number | null
          orcamento_id?: string
          updated_at?: string
          valor_subtotal?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_custos_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: true
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_item_custos: {
        Row: {
          custo_unitario: number
          orcamento_item_id: string
          updated_at: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          custo_unitario?: number
          orcamento_item_id: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          custo_unitario?: number
          orcamento_item_id?: string
          updated_at?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_item_custos_orcamento_item_id_fkey"
            columns: ["orcamento_item_id"]
            isOneToOne: true
            referencedRelation: "orcamento_itens_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens: {
        Row: {
          created_at: string
          custo_unitario: number
          descricao: string
          id: string
          orcamento_id: string
          ordem: number
          produto_id: string | null
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          descricao: string
          id?: string
          orcamento_id: string
          ordem?: number
          produto_id?: string | null
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          descricao?: string
          id?: string
          orcamento_id?: string
          ordem?: number
          produto_id?: string | null
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          aprovado_em: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          custo_estimado: number
          desconto_percentual: number
          descricao: string | null
          enviado_em: string | null
          id: string
          margem_estimada: number | null
          numero: number
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at: string
          validade_dias: number
          valor_subtotal: number
          valor_total: number
          vendedor_id: string | null
        }
        Insert: {
          aprovado_em?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          enviado_em?: string | null
          id?: string
          margem_estimada?: number | null
          numero?: number
          observacoes?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
        }
        Update: {
          aprovado_em?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          enviado_em?: string | null
          id?: string
          margem_estimada?: number | null
          numero?: number
          observacoes?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo?: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico: {
        Row: {
          briefing: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          custo_previsto: number
          custo_real: number
          data_entrega_real: string | null
          designer_id: string | null
          estoque_baixado: boolean
          estoque_baixado_em: string | null
          id: string
          maquina_id: string | null
          margem_real: number | null
          numero: number
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number
          prazo_entrega: string | null
          prioridade: number
          produto_id: string | null
          responsavel_id: string | null
          setor_atual: string | null
          status: Database["public"]["Enums"]["status_os"]
          titulo: string
          updated_at: string
          valor_total: number
          vendedor_id: string | null
        }
        Insert: {
          briefing?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          designer_id?: string | null
          estoque_baixado?: boolean
          estoque_baixado_em?: string | null
          id?: string
          maquina_id?: string | null
          margem_real?: number | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_entrega?: string | null
          prioridade?: number
          produto_id?: string | null
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          titulo: string
          updated_at?: string
          valor_total?: number
          vendedor_id?: string | null
        }
        Update: {
          briefing?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          designer_id?: string | null
          estoque_baixado?: boolean
          estoque_baixado_em?: string | null
          id?: string
          maquina_id?: string | null
          margem_real?: number | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_entrega?: string | null
          prioridade?: number
          produto_id?: string | null
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          titulo?: string
          updated_at?: string
          valor_total?: number
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "rel_producao_por_maquina"
            referencedColumns: ["maquina_id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      os_resultados: {
        Row: {
          created_at: string
          custo_previsto: number
          custo_real: number
          fechado_em: string
          fechado_por: string | null
          id: string
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          margem_real: number | null
          material_consumido: number
          material_previsto: number | null
          motivo_divergencia: string | null
          os_id: string
          tempo_previsto: number | null
          tempo_real: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          fechado_em?: string
          fechado_por?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_consumido?: number
          material_previsto?: number | null
          motivo_divergencia?: string | null
          os_id: string
          tempo_previsto?: number | null
          tempo_real?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_previsto?: number
          custo_real?: number
          fechado_em?: string
          fechado_por?: string | null
          id?: string
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          material_consumido?: number
          material_previsto?: number | null
          motivo_divergencia?: string | null
          os_id?: string
          tempo_previsto?: number | null
          tempo_real?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_resultados_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      os_resultados_financeiros: {
        Row: {
          custo_previsto: number
          custo_real: number
          margem_real: number | null
          os_id: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          custo_previsto?: number
          custo_real?: number
          margem_real?: number | null
          os_id: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          custo_previsto?: number
          custo_real?: number
          margem_real?: number | null
          os_id?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "os_resultados_financeiros_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: true
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          comprovante_url: string | null
          created_at: string
          data_pagamento: string | null
          data_vencimento: string | null
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          os_id: string
          parcela: number
          registrado_por: string | null
          status: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas: number
          updated_at: string
          valor: number
        }
        Insert: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id: string
          parcela?: number
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas?: number
          updated_at?: string
          valor: number
        }
        Update: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id?: string
          parcela?: number
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas?: number
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "pagamentos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_materiais: {
        Row: {
          created_at: string
          id: string
          material_id: string
          observacao: string | null
          produto_id: string
          quantidade_por_unidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          observacao?: string | null
          produto_id: string
          quantidade_por_unidade?: number
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          observacao?: string | null
          produto_id?: string
          quantidade_por_unidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_precificacao: {
        Row: {
          custo_base: number | null
          preco_base: number | null
          produto_id: string
          updated_at: string
        }
        Insert: {
          custo_base?: number | null
          preco_base?: number | null
          produto_id: string
          updated_at?: string
        }
        Update: {
          custo_base?: number | null
          preco_base?: number | null
          produto_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_precificacao_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: true
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: true
            referencedRelation: "produtos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precificacao_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: true
            referencedRelation: "produtos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          categoria: Database["public"]["Enums"]["categoria_produto"]
          created_at: string
          custo_medio: number
          descricao: string | null
          id: string
          imagem_url: string | null
          margem_minima: number
          nome: string
          observacoes_internas: string | null
          preco_base: number | null
          sku: string | null
          tempo_producao_min: number | null
          tipo: Database["public"]["Enums"]["tipo_item"]
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["categoria_produto"]
          created_at?: string
          custo_medio?: number
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          margem_minima?: number
          nome: string
          observacoes_internas?: string | null
          preco_base?: number | null
          sku?: string | null
          tempo_producao_min?: number | null
          tipo?: Database["public"]["Enums"]["tipo_item"]
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: Database["public"]["Enums"]["categoria_produto"]
          created_at?: string
          custo_medio?: number
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          margem_minima?: number
          nome?: string
          observacoes_internas?: string | null
          preco_base?: number | null
          sku?: string | null
          tempo_producao_min?: number | null
          tipo?: Database["public"]["Enums"]["tipo_item"]
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      relatorios: {
        Row: {
          created_at: string
          descricao: string | null
          gerado_em: string | null
          grupo: string
          id: string
          nome: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          gerado_em?: string | null
          grupo: string
          id?: string
          nome: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          gerado_em?: string | null
          grupo?: string
          id?: string
          nome?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      respostas_rapidas: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          texto: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          texto: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          texto?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          concluida: boolean
          concluida_em: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          os_id: string
          prazo: string | null
          responsavel_id: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          concluida?: boolean
          concluida_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          os_id: string
          prazo?: string | null
          responsavel_id?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          concluida?: boolean
          concluida_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          os_id?: string
          prazo?: string | null
          responsavel_id?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "tarefas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_automacoes: {
        Row: {
          acoes: Json
          ativa: boolean
          condicoes: Json
          created_at: string
          created_by: string | null
          gatilho: Database["public"]["Enums"]["whatsapp_automacao_gatilho"]
          id: string
          instancia_id: string | null
          nome: string
          prioridade: number
          updated_at: string
        }
        Insert: {
          acoes?: Json
          ativa?: boolean
          condicoes?: Json
          created_at?: string
          created_by?: string | null
          gatilho: Database["public"]["Enums"]["whatsapp_automacao_gatilho"]
          id?: string
          instancia_id?: string | null
          nome: string
          prioridade?: number
          updated_at?: string
        }
        Update: {
          acoes?: Json
          ativa?: boolean
          condicoes?: Json
          created_at?: string
          created_by?: string | null
          gatilho?: Database["public"]["Enums"]["whatsapp_automacao_gatilho"]
          id?: string
          instancia_id?: string | null
          nome?: string
          prioridade?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_automacoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_automacoes_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversas: {
        Row: {
          atribuido_para: string | null
          cliente_id: string | null
          created_at: string
          etiquetas: string[]
          id: string
          instancia_id: string
          lead_id: string | null
          metadados: Json
          nao_lidas: number
          nome_contato: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone: string
          telefone_normalizado: string | null
          ultima_mensagem: string | null
          ultima_mensagem_at: string | null
          updated_at: string
        }
        Insert: {
          atribuido_para?: string | null
          cliente_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          instancia_id: string
          lead_id?: string | null
          metadados?: Json
          nao_lidas?: number
          nome_contato?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone: string
          telefone_normalizado?: string | null
          ultima_mensagem?: string | null
          ultima_mensagem_at?: string | null
          updated_at?: string
        }
        Update: {
          atribuido_para?: string | null
          cliente_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          instancia_id?: string
          lead_id?: string | null
          metadados?: Json
          nao_lidas?: number
          nome_contato?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["whatsapp_conversa_status"]
          telefone?: string
          telefone_normalizado?: string | null
          ultima_mensagem?: string | null
          ultima_mensagem_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversas_atribuido_para_fkey"
            columns: ["atribuido_para"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_conversas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      whatsapp_instancias: {
        Row: {
          ativa: boolean
          conectado: boolean
          created_at: string
          id: string
          metadados: Json
          nome: string
          numero: string | null
          numero_normalizado: string | null
          status: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at: string | null
          updated_at: string
          webhook_secret_hash: string | null
          zapi_instance_id: string
        }
        Insert: {
          ativa?: boolean
          conectado?: boolean
          created_at?: string
          id?: string
          metadados?: Json
          nome: string
          numero?: string | null
          numero_normalizado?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          zapi_instance_id: string
        }
        Update: {
          ativa?: boolean
          conectado?: boolean
          created_at?: string
          id?: string
          metadados?: Json
          nome?: string
          numero?: string | null
          numero_normalizado?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instancia_status"]
          ultimo_evento_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          zapi_instance_id?: string
        }
        Relationships: []
      }
      whatsapp_logs: {
        Row: {
          conversa_id: string | null
          created_at: string
          erro: string | null
          id: string
          instancia_id: string | null
          mensagem_id: string | null
          request: Json | null
          response: Json | null
          sucesso: boolean
          tipo: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          instancia_id?: string | null
          mensagem_id?: string | null
          request?: Json | null
          response?: Json | null
          sucesso?: boolean
          tipo: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Update: {
          conversa_id?: string | null
          created_at?: string
          erro?: string | null
          id?: string
          instancia_id?: string | null
          mensagem_id?: string | null
          request?: Json | null
          response?: Json | null
          sucesso?: boolean
          tipo?: Database["public"]["Enums"]["whatsapp_log_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_mensagens: {
        Row: {
          arquivo_id: string | null
          cliente_id: string | null
          conversa_id: string
          created_at: string
          direcao: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em: string | null
          enviada_por: string | null
          enviado_em: string | null
          erro: string | null
          id: string
          instancia_id: string
          legenda: string | null
          lido_em: string | null
          media_url: string | null
          os_id: string | null
          payload: Json
          recebido_em: string | null
          status: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket: string | null
          storage_path: string | null
          texto: string | null
          tipo: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at: string
          zapi_message_id: string | null
        }
        Insert: {
          arquivo_id?: string | null
          cliente_id?: string | null
          conversa_id: string
          created_at?: string
          direcao: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em?: string | null
          enviada_por?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          instancia_id: string
          legenda?: string | null
          lido_em?: string | null
          media_url?: string | null
          os_id?: string | null
          payload?: Json
          recebido_em?: string | null
          status?: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          texto?: string | null
          tipo?: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at?: string
          zapi_message_id?: string | null
        }
        Update: {
          arquivo_id?: string | null
          cliente_id?: string | null
          conversa_id?: string
          created_at?: string
          direcao?: Database["public"]["Enums"]["whatsapp_mensagem_direcao"]
          entregue_em?: string | null
          enviada_por?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          instancia_id?: string
          legenda?: string | null
          lido_em?: string | null
          media_url?: string | null
          os_id?: string | null
          payload?: Json
          recebido_em?: string | null
          status?: Database["public"]["Enums"]["whatsapp_mensagem_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          texto?: string | null
          tipo?: Database["public"]["Enums"]["whatsapp_mensagem_tipo"]
          updated_at?: string
          zapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_mensagens_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_enviada_por_fkey"
            columns: ["enviada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "whatsapp_mensagens_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      whatsapp_respostas_rapidas: {
        Row: {
          anexos: Json
          atalho: string | null
          ativa: boolean
          categoria: string | null
          conteudo: string
          created_at: string
          created_by: string | null
          id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          anexos?: Json
          atalho?: string | null
          ativa?: boolean
          categoria?: string | null
          conteudo: string
          created_at?: string
          created_by?: string | null
          id?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          anexos?: Json
          atalho?: string | null
          ativa?: boolean
          categoria?: string | null
          conteudo?: string
          created_at?: string
          created_by?: string | null
          id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_respostas_rapidas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      itens_os_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          descricao: string | null
          id: string | null
          ordem: number | null
          os_id: string | null
          quantidade: number | null
          unidade: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      itens_os_operacional: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string | null
          ordem: number | null
          os_id: string | null
          quantidade: number | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          ordem?: number | null
          os_id?: string | null
          quantidade?: number | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          ordem?: number | null
          os_id?: string | null
          quantidade?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
        ]
      }
      materiais_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          estoque: number | null
          id: string | null
          nome: string | null
          unidade: string | null
        }
        Relationships: []
      }
      materiais_operacional: {
        Row: {
          created_at: string | null
          estoque: number | null
          id: string | null
          nome: string | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          estoque?: number | null
          id?: string | null
          nome?: string | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          estoque?: number | null
          id?: string | null
          nome?: string | null
          unidade?: string | null
        }
        Relationships: []
      }
      orcamento_itens_financeiro: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          descricao: string | null
          id: string | null
          orcamento_id: string | null
          ordem: number | null
          quantidade: number | null
          unidade: string | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens_operacional: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string | null
          orcamento_id: string | null
          ordem: number | null
          quantidade: number | null
          unidade: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          orcamento_id?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          orcamento_id?: string | null
          ordem?: number | null
          quantidade?: number | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_financeiro: {
        Row: {
          aprovado_em: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          custo_estimado: number | null
          desconto_percentual: number | null
          descricao: string | null
          enviado_em: string | null
          id: string | null
          margem_estimada: number | null
          numero: number | null
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"] | null
          titulo: string | null
          updated_at: string | null
          validade_dias: number | null
          valor_subtotal: number | null
          valor_total: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos_operacional: {
        Row: {
          aprovado_em: string | null
          cliente_id: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          descricao: string | null
          enviado_em: string | null
          id: string | null
          numero: number | null
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"] | null
          titulo: string | null
          updated_at: string | null
          validade_dias: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_lucro_por_os"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "rel_os_atrasadas"
            referencedColumns: ["os_id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico_financeiro: {
        Row: {
          briefing: string | null
          cliente_id: string | null
          cliente_logo_url: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          custo_previsto: number | null
          custo_real: number | null
          data_entrega_real: string | null
          designer_id: string | null
          id: string | null
          margem_real: number | null
          numero: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number | null
          prazo_entrega: string | null
          prioridade: number | null
          responsavel_id: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          updated_at: string | null
          valor_total: number | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico_operacional: {
        Row: {
          briefing: string | null
          cliente_id: string | null
          cliente_logo_url: string | null
          cliente_nome: string | null
          created_at: string | null
          created_by: string | null
          data_entrega_real: string | null
          designer_id: string | null
          id: string | null
          numero: number | null
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number | null
          prazo_entrega: string | null
          prioridade: number | null
          responsavel_id: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          updated_at: string | null
          vendedor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_operacional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos_financeiro: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          custo_base: number | null
          descricao: string | null
          id: string | null
          nome: string | null
          preco_base: number | null
        }
        Relationships: []
      }
      produtos_operacional: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          id: string | null
          nome: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          nome?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string | null
          nome?: string | null
        }
        Relationships: []
      }
      rel_faturamento_por_periodo: {
        Row: {
          faturamento: number | null
          ordens_servico: number | null
          pagamentos: number | null
          periodo: string | null
        }
        Relationships: []
      }
      rel_lucro_por_os: {
        Row: {
          cliente: string | null
          criada_em: string | null
          custo: number | null
          lucro: number | null
          margem_percentual: number | null
          numero: number | null
          os_id: string | null
          receita: number | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
        }
        Relationships: []
      }
      rel_margem_por_produto: {
        Row: {
          custo: number | null
          margem_percentual: number | null
          margem_valor: number | null
          primeira_venda: string | null
          produto: string | null
          quantidade: number | null
          receita: number | null
          ultima_venda: string | null
        }
        Relationships: []
      }
      rel_os_atrasadas: {
        Row: {
          cliente: string | null
          dias_atraso: number | null
          numero: number | null
          os_id: string | null
          prazo_entrega: string | null
          status: Database["public"]["Enums"]["status_os"] | null
          titulo: string | null
          valor_total: number | null
        }
        Relationships: []
      }
      rel_producao_por_maquina: {
        Row: {
          apontamentos: number | null
          horas_produzidas: number | null
          maquina: string | null
          maquina_id: string | null
          ordens_servico: number | null
          primeiro_apontamento: string | null
          quantidade_produzida: number | null
          tipo: string | null
          ultimo_apontamento: string | null
        }
        Relationships: []
      }
      rel_retrabalho_por_setor: {
        Row: {
          custo_total: number | null
          ocorrencias: number | null
          primeira_ocorrencia: string | null
          retrabalhos: number | null
          setor: string | null
          ultima_ocorrencia: string | null
        }
        Relationships: []
      }
      rel_tempo_medio_por_etapa: {
        Row: {
          apontamentos_concluidos: number | null
          etapa: string | null
          horas_maxima: number | null
          horas_media: number | null
          horas_minima: number | null
        }
        Relationships: []
      }
      rel_whatsapp_conversas_abertas: {
        Row: {
          aberta_em: string | null
          atendente: string | null
          contato_nome: string | null
          conversa_id: string | null
          etiqueta: string | null
          mensagens_entrada: number | null
          mensagens_saida: number | null
          telefone: string | null
          ultima_mensagem_em: string | null
        }
        Relationships: []
      }
      rel_whatsapp_tempo_medio_resposta: {
        Row: {
          atendente: string | null
          contato_nome: string | null
          conversa_id: string | null
          minutos_media_resposta: number | null
          respostas: number | null
        }
        Relationships: []
      }
      role_permission_matrix: {
        Row: {
          permission: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      _apply_pending_migration: { Args: { p_sql: string }; Returns: undefined }
      automacao_condicao_ok: {
        Args: {
          p_condicao: Json
          p_contexto: Json
          p_gatilho: Database["public"]["Enums"]["automacao_gatilho"]
        }
        Returns: boolean
      }
      automacao_contexto_os: {
        Args: { p_os: Database["public"]["Tables"]["ordens_servico"]["Row"] }
        Returns: Json
      }
      can_see_financials: { Args: { _user_id: string }; Returns: boolean }
      criar_eventos_automacoes_recorrentes: { Args: never; Returns: number }
      enqueue_automacoes: {
        Args: {
          p_contexto?: Json
          p_entidade: string
          p_entidade_id: string
          p_gatilho: Database["public"]["Enums"]["automacao_gatilho"]
        }
        Returns: number
      }
      fechar_os: {
        Args: { os_id: string }
        Returns: {
          created_at: string
          custo_previsto: number
          custo_real: number
          fechado_em: string
          fechado_por: string | null
          id: string
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          margem_real: number | null
          material_consumido: number
          material_previsto: number | null
          motivo_divergencia: string | null
          os_id: string
          tempo_previsto: number | null
          tempo_real: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "os_resultados"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_relatorios_prioritarios: {
        Args: { p_fim?: string; p_inicio?: string }
        Returns: Json
      }
      has_any_permission: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      normalize_whatsapp_phone: { Args: { _phone: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "admin"
        | "gestor"
        | "financeiro"
        | "vendedor"
        | "designer"
        | "operador"
        | "estoque"
        | "instalador"
        | "cliente"
      automacao_acao: "whatsapp"
      automacao_execucao_status:
        | "pendente"
        | "processando"
        | "sucesso"
        | "erro"
        | "ignorado"
      automacao_gatilho:
        | "status_os_alterado"
        | "pagamento_atrasado"
        | "estoque_minimo"
        | "margem_abaixo_minimo"
        | "os_atrasada"
        | "os_concluida"
      canal_aprovacao:
        | "sistema"
        | "whatsapp"
        | "email"
        | "presencial"
        | "telefone"
      categoria_produto:
        | "impressao_grande_formato"
        | "adesivos"
        | "comunicacao_visual"
        | "brindes"
        | "acabamento"
        | "instalacao"
        | "servico"
        | "outros"
      status_arquivo:
        | "ativo"
        | "substituido"
        | "inativo"
        | "aprovado"
        | "rejeitado"
      status_orcamento:
        | "rascunho"
        | "enviado"
        | "aprovado"
        | "rejeitado"
        | "expirado"
        | "convertido"
      status_os:
        | "entrada"
        | "aguardando_briefing"
        | "briefing_ok"
        | "design"
        | "aguardando_aprovacao_arte"
        | "arte_aprovada"
        | "arte_rejeitada"
        | "aguardando_producao"
        | "producao"
        | "em_producao"
        | "em_impressao"
        | "em_corte"
        | "em_acabamento"
        | "em_uv"
        | "em_laser_cnc"
        | "em_3d"
        | "controle_qualidade"
        | "aguardando_retirada"
        | "aguardando_entrega"
        | "em_entrega"
        | "em_instalacao"
        | "concluido"
        | "faturado"
        | "cancelado"
        | "retrabalho"
        | "pausado"
      status_pagamento:
        | "pendente"
        | "parcial"
        | "pago"
        | "atrasado"
        | "cancelado"
      tipo_aprovacao: "arte" | "orcamento"
      tipo_arquivo:
        | "arte"
        | "briefing"
        | "referencia"
        | "producao"
        | "orcamento"
        | "comprovante"
        | "outro"
      tipo_cliente: "pf" | "pj"
      tipo_item: "produto" | "servico"
      whatsapp_automacao_gatilho:
        | "mensagem_recebida"
        | "palavra_chave"
        | "fora_horario"
        | "primeiro_contato"
        | "status_conexao"
      whatsapp_conversa_status:
        | "aberta"
        | "pendente"
        | "resolvida"
        | "arquivada"
      whatsapp_instancia_status:
        | "desconectada"
        | "conectando"
        | "conectada"
        | "erro"
      whatsapp_log_tipo:
        | "envio_texto"
        | "envio_imagem"
        | "envio_documento"
        | "webhook_mensagem"
        | "webhook_status"
        | "webhook_conexao"
        | "erro"
      whatsapp_mensagem_direcao: "entrada" | "saida"
      whatsapp_mensagem_status:
        | "recebida"
        | "pendente"
        | "enviada"
        | "entregue"
        | "lida"
        | "falha"
      whatsapp_mensagem_tipo:
        | "texto"
        | "imagem"
        | "documento"
        | "audio"
        | "video"
        | "sticker"
        | "localizacao"
        | "contato"
        | "sistema"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "gestor",
        "financeiro",
        "vendedor",
        "designer",
        "operador",
        "estoque",
        "instalador",
        "cliente",
      ],
      automacao_acao: ["whatsapp"],
      automacao_execucao_status: [
        "pendente",
        "processando",
        "sucesso",
        "erro",
        "ignorado",
      ],
      automacao_gatilho: [
        "status_os_alterado",
        "pagamento_atrasado",
        "estoque_minimo",
        "margem_abaixo_minimo",
        "os_atrasada",
        "os_concluida",
      ],
      canal_aprovacao: [
        "sistema",
        "whatsapp",
        "email",
        "presencial",
        "telefone",
      ],
      categoria_produto: [
        "impressao_grande_formato",
        "adesivos",
        "comunicacao_visual",
        "brindes",
        "acabamento",
        "instalacao",
        "servico",
        "outros",
      ],
      status_arquivo: [
        "ativo",
        "substituido",
        "inativo",
        "aprovado",
        "rejeitado",
      ],
      status_orcamento: [
        "rascunho",
        "enviado",
        "aprovado",
        "rejeitado",
        "expirado",
        "convertido",
      ],
      status_os: [
        "entrada",
        "aguardando_briefing",
        "briefing_ok",
        "design",
        "aguardando_aprovacao_arte",
        "arte_aprovada",
        "arte_rejeitada",
        "aguardando_producao",
        "producao",
        "em_producao",
        "em_impressao",
        "em_corte",
        "em_acabamento",
        "em_uv",
        "em_laser_cnc",
        "em_3d",
        "controle_qualidade",
        "aguardando_retirada",
        "aguardando_entrega",
        "em_entrega",
        "em_instalacao",
        "concluido",
        "faturado",
        "cancelado",
        "retrabalho",
        "pausado",
      ],
      status_pagamento: [
        "pendente",
        "parcial",
        "pago",
        "atrasado",
        "cancelado",
      ],
      tipo_aprovacao: ["arte", "orcamento"],
      tipo_arquivo: [
        "arte",
        "briefing",
        "referencia",
        "producao",
        "orcamento",
        "comprovante",
        "outro",
      ],
      tipo_cliente: ["pf", "pj"],
      tipo_item: ["produto", "servico"],
      whatsapp_automacao_gatilho: [
        "mensagem_recebida",
        "palavra_chave",
        "fora_horario",
        "primeiro_contato",
        "status_conexao",
      ],
      whatsapp_conversa_status: [
        "aberta",
        "pendente",
        "resolvida",
        "arquivada",
      ],
      whatsapp_instancia_status: [
        "desconectada",
        "conectando",
        "conectada",
        "erro",
      ],
      whatsapp_log_tipo: [
        "envio_texto",
        "envio_imagem",
        "envio_documento",
        "webhook_mensagem",
        "webhook_status",
        "webhook_conexao",
        "erro",
      ],
      whatsapp_mensagem_direcao: ["entrada", "saida"],
      whatsapp_mensagem_status: [
        "recebida",
        "pendente",
        "enviada",
        "entregue",
        "lida",
        "falha",
      ],
      whatsapp_mensagem_tipo: [
        "texto",
        "imagem",
        "documento",
        "audio",
        "video",
        "sticker",
        "localizacao",
        "contato",
        "sistema",
      ],
    },
  },
} as const
