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
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
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
          caminho: string
          cliente_id: string | null
          created_at: string
          enviado_por: string | null
          final_producao: boolean
          id: string
          mime_type: string | null
          nome: string
          os_id: string | null
          substituido_por: string | null
          tamanho_bytes: number | null
          versao: number
        }
        Insert: {
          caminho: string
          cliente_id?: string | null
          created_at?: string
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome: string
          os_id?: string | null
          substituido_por?: string | null
          tamanho_bytes?: number | null
          versao?: number
        }
        Update: {
          caminho?: string
          cliente_id?: string | null
          created_at?: string
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome?: string
          os_id?: string | null
          substituido_por?: string | null
          tamanho_bytes?: number | null
          versao?: number
        }
        Relationships: [
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
            foreignKeyName: "arquivos_substituido_por_fkey"
            columns: ["substituido_por"]
            isOneToOne: false
            referencedRelation: "arquivos"
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
          os_id: string
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
          os_id: string
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
          os_id?: string
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
            foreignKeyName: "itens_os_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
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
      materiais: {
        Row: {
          created_at: string
          custo_unitario: number | null
          estoque: number
          id: string
          nome: string
          unidade: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          id?: string
          nome: string
          unidade?: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          id?: string
          nome?: string
          unidade?: string
        }
        Relationships: []
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
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
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
          descricao: string
          id: string
          os_id: string
          registrado_por: string | null
          resolvida: boolean
          tipo: string
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          os_id: string
          registrado_por?: string | null
          resolvida?: boolean
          tipo: string
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          os_id?: string
          registrado_por?: string | null
          resolvida?: boolean
          tipo?: string
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
            foreignKeyName: "ocorrencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
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
            foreignKeyName: "orcamento_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
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
          margem_real: number | null
          numero: number
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number
          prazo_entrega: string | null
          prioridade: number
          responsavel_id: string | null
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
          margem_real?: number | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_entrega?: string | null
          prioridade?: number
          responsavel_id?: string | null
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
          margem_real?: number | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          prazo_entrega?: string | null
          prioridade?: number
          responsavel_id?: string | null
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
            foreignKeyName: "produto_materiais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aprovar_orcamento: { Args: { p_orcamento_id: string; p_versao_id?: string | null; p_observacao?: string | null }; Returns: Json }
      avancar_os_status: { Args: { p_os_id: string; p_novo_status: string; p_justificativa?: string | null }; Returns: Json }
      confirmar_pagamento: { Args: { p_parcela_id: string; p_valor: number; p_meio: string; p_taxa?: number; p_data?: string; p_comprovante?: string | null; p_referencia_externa?: string | null }; Returns: Json }
      confirmar_pagamento_registrado: { Args: { p_pagamento_id: string; p_data?: string; p_referencia_externa?: string | null }; Returns: Json }
      converter_lead_em_cliente: { Args: { p_lead_id: string; p_dados: Json; p_criar_orcamento?: boolean }; Returns: Json }
      converter_orcamento_em_os: { Args: { p_orcamento_id: string; p_opcoes?: Json }; Returns: Json }
      estornar_pagamento: { Args: { p_pagamento_id: string; p_motivo: string }; Returns: Json }
      fechar_os: { Args: { os_id: string }; Returns: Json }
      forcar_transicao_os: { Args: { p_os_id: string; p_novo_status: string; p_motivo: string }; Returns: Json }
      can_see_financials: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
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
      status_orcamento:
        | "rascunho"
        | "enviado"
        | "aprovado"
        | "rejeitado"
        | "expirado"
        | "convertido"
      status_os:
        | "novo"
        | "aguardando_briefing"
        | "briefing_ok"
        | "em_design"
        | "aguardando_aprovacao_arte"
        | "arte_aprovada"
        | "arte_rejeitada"
        | "aguardando_producao"
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
      tipo_cliente: "pf" | "pj"
      tipo_item: "produto" | "servico"
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
      status_orcamento: [
        "rascunho",
        "enviado",
        "aprovado",
        "rejeitado",
        "expirado",
        "convertido",
      ],
      status_os: [
        "novo",
        "aguardando_briefing",
        "briefing_ok",
        "em_design",
        "aguardando_aprovacao_arte",
        "arte_aprovada",
        "arte_rejeitada",
        "aguardando_producao",
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
      tipo_cliente: ["pf", "pj"],
      tipo_item: ["produto", "servico"],
    },
  },
} as const
