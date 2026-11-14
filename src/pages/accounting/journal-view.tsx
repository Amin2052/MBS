import { useEffect, useState } from "react";

import { useCurrency } from "../../hooks/use-currency";
import { formatDateShort } from "../../utils/date-format";


interface JournalViewProps {
    canManage: boolean;
}


const emptyJournalForm = {
    entry_date: new Date().toISOString().slice(0, 10),
    debit_account_id: "",
    credit_account_id: "",
    amount: "",
    reference: "",
    description: ""
};


// Journal Entry System (Task 10, Section 3). Lists every posted
// journal entry (automatic postings from invoices/expenses included)
// and lets a permitted user post a manual entry directly against the
// Chart of Accounts. Debit/credit balance is guaranteed by
// construction here -- a journal entry is always exactly one debit
// account, one credit account, one shared amount -- and the backend
// (ledger-repository.ts) rejects anything else.
export default function JournalView({ canManage }: JournalViewProps) {

    const { format: formatCurrency } = useCurrency();

    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);

    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState(emptyJournalForm);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);


    async function loadJournal() {

        setLoading(true);

        try {
            const [journalData, accountData] = await Promise.all([
                window.mooral.journal.get(),
                window.mooral.ledger.accounts()
            ]);

            setEntries(journalData);
            setAccounts(accountData);
        }
        finally {
            setLoading(false);
        }

    }


    useEffect(() => {
        loadJournal();
    }, []);


    function openCreateModal() {

        if (!canManage) {
            return;
        }

        setForm(emptyJournalForm);
        setError("");
        setShowModal(true);

    }


    async function handleSubmit() {

        if (!form.debit_account_id || !form.credit_account_id) {
            setError("Select both a debit and credit account.");
            return;
        }

        if (form.debit_account_id === form.credit_account_id) {
            setError("Debit and credit accounts must be different.");
            return;
        }

        const amount = Number(form.amount);

        if (!amount || amount <= 0) {
            setError("Amount must be greater than 0.");
            return;
        }

        if (!form.description.trim()) {
            setError("Description is required.");
            return;
        }

        setIsSubmitting(true);
        setError("");

        try {

            await window.mooral.journal.create({
                entry_date: form.entry_date,
                debit_account_id: Number(form.debit_account_id),
                credit_account_id: Number(form.credit_account_id),
                amount,
                reference: form.reference.trim() || undefined,
                description: form.description.trim()
            });

            setShowModal(false);
            await loadJournal();

        }
        catch (err: any) {
            setError(err?.message || "Failed to post journal entry.");
        }
        finally {
            setIsSubmitting(false);
        }

    }


    return (

        <div className="journal-view">

            <div className="accounting-toolbar">

                <div className="journal-count-label">
                    {entries.length} Journal {entries.length === 1 ? "Entry" : "Entries"}
                </div>

                {
                    canManage &&
                    <button
                        type="button"
                        className="add-transaction-btn"
                        onClick={openCreateModal}
                    >
                        + New Journal Entry
                    </button>
                }

            </div>


            <div className="accounting-table journal-table">

                <div className="accounting-table-head journal-table-row">
                    <span>Journal ID</span>
                    <span>Date</span>
                    <span>Debit Account</span>
                    <span>Credit Account</span>
                    <span className="amount-column-head">Amount</span>
                    <span>Reference</span>
                    <span>Description</span>
                </div>

                {
                    !loading && entries.length === 0 &&
                    <div className="empty-transactions">
                        No Journal Entries Found
                    </div>
                }

                {
                    entries.map(entry => (
                        <div key={entry.id} className="accounting-table-row journal-table-row">

                            <span className="transaction-id">{entry.journal_id}</span>

                            <span>{formatDateShort(entry.entry_date)}</span>

                            <span>{entry.debit_account_name}</span>

                            <span>{entry.credit_account_name}</span>

                            <span className="amount-income">
                                {formatCurrency(entry.amount)}
                            </span>

                            <span>{entry.reference || "-"}</span>

                            <span title={entry.description ?? ""}>
                                {entry.description || "-"}
                            </span>

                        </div>
                    ))
                }

            </div>


            {
                showModal &&
                <div className="modal-overlay">
                    <div className="accounting-modal">

                        <div className="modal-header">
                            <h2>New Journal Entry</h2>
                            <button type="button" onClick={() => setShowModal(false)}>
                                ✕
                            </button>
                        </div>

                        {
                            error &&
                            <div className="form-error">{error}</div>
                        }

                        <div className="accounting-form-grid">

                            <div className="form-field">
                                <label>Date</label>
                                <input
                                    type="date"
                                    value={form.entry_date}
                                    onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                                />
                            </div>

                            <div className="form-field">
                                <label>Reference</label>
                                <input
                                    type="text"
                                    placeholder="Optional reference"
                                    value={form.reference}
                                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                                />
                            </div>

                            <div className="form-field">
                                <label>Debit Account</label>
                                <select
                                    value={form.debit_account_id}
                                    onChange={(e) => setForm({ ...form, debit_account_id: e.target.value })}
                                >
                                    <option value="">Select account</option>
                                    {
                                        accounts.map(account => (
                                            <option key={account.id} value={account.id}>
                                                {account.code} - {account.name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            <div className="form-field">
                                <label>Credit Account</label>
                                <select
                                    value={form.credit_account_id}
                                    onChange={(e) => setForm({ ...form, credit_account_id: e.target.value })}
                                >
                                    <option value="">Select account</option>
                                    {
                                        accounts.map(account => (
                                            <option key={account.id} value={account.id}>
                                                {account.code} - {account.name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            <div className="form-field">
                                <label>Amount</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.amount}
                                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                />
                            </div>

                            <div className="form-field full">
                                <label>Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                />
                            </div>

                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                className="cancel-btn"
                                onClick={() => setShowModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="save-btn"
                                disabled={isSubmitting}
                                onClick={handleSubmit}
                            >
                                {isSubmitting ? "Posting..." : "Post Entry"}
                            </button>
                        </div>

                    </div>
                </div>
            }

        </div>

    );

}
