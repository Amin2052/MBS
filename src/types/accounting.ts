export interface Transaction {
  id?: number;

  transaction_id: string;

  type: "Income" | "Expense";

  category: string;

  description: string;

  amount: number;

  payment_method: string;

  reference_no?: string;

  transaction_date: string;

  notes?: string;

  created_at?: string;

  updated_at?: string;
}

export interface TransactionSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  totalTransactions: number;
}

export interface TransactionForm
  extends Omit<
    Transaction,
    "id" | "created_at" | "updated_at"
  > {}