import { useEffect, useMemo, useState } from "react";

import { useCurrency } from "../../hooks/use-currency";
import { formatDateShort } from "../../utils/date-format";
import {
    DATE_RANGE_PRESETS,
    getPresetDateRange,
    type DateRangePresetKey
} from "../../utils/date-range-presets";


interface LedgerViewProps {
    canManage: boolean;
}


// Ledger System (Task 10, Section 2). Two lenses on the same
// ledger_entries table: a per-customer sub-ledger (Accounts
// Receivable, filtered by customer) and a general-accounts ledger
// (Cash/Bank, Sales Revenue, Expense accounts, ...). Both share the
// same table/toolbar CSS classes as the Transactions tab so the page
// stays visually consistent.
export default function LedgerView({ canManage }: LedgerViewProps) {

    const { format: formatCurrency } = useCurrency();

    void canManage; // read-only view -- kept for a consistent prop shape with the other tabs

    const [mode, setMode] = useState<"customer" | "general">("customer");

    const [customers, setCustomers] = useState<{ customer_id: string; customer_name: string }[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState("");

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>("");

    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const [datePreset, setDatePreset] = useState<DateRangePresetKey>("all");
    const [customStartDate, setCustomStartDate] = useState("");
    const [customEndDate, setCustomEndDate] = useState("");

    const { fromDate, toDate } = useMemo(
        () => getPresetDateRange(datePreset, customStartDate, customEndDate),
        [datePreset, customStartDate, customEndDate]
    );


    useEffect(() => {

        window.mooral.ledger.customersWithActivity().then(setCustomers);
        window.mooral.ledger.accounts().then(setAccounts);

    }, []);


    useEffect(() => {

        if (mode === "customer" && !selectedCustomerId && customers.length > 0) {
            setSelectedCustomerId(customers[0].customer_id);
        }

    }, [mode, customers, selectedCustomerId]);


    async function loadEntries() {

        setLoading(true);

        try {

            if (mode === "customer") {

                if (!selectedCustomerId) {
                    setEntries([]);
                    return;
                }

                const data = await window.mooral.ledger.customerLedger({
                    customerId: selectedCustomerId,
                    fromDate: fromDate || undefined,
                    toDate: toDate || undefined
                });

                setEntries(data);

            }
            else {

                const data = await window.mooral.ledger.generalLedger({
                    accountId: selectedAccountId ? Number(selectedAccountId) : undefined,
                    fromDate: fromDate || undefined,
                    toDate: toDate || undefined
                });

                setEntries(data);

            }

        }
        finally {
            setLoading(false);
        }

    }


    useEffect(() => {

        loadEntries();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, selectedCustomerId, selectedAccountId, fromDate, toDate]);


    const closingBalance = entries.length > 0
        ? entries[entries.length - 1].running_balance
        : 0;


    return (

        <div className="ledger-view">

            <div className="accounting-toolbar">

                <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "customer" | "general")}
                    aria-label="Ledger type"
                >
                    <option value="customer">Customer Ledger</option>
                    <option value="general">General Accounts</option>
                </select>

                {
                    mode === "customer" &&
                    <select
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        aria-label="Customer"
                    >
                        {
                            customers.length === 0 &&
                            <option value="">No customer activity yet</option>
                        }
                        {
                            customers.map(customer => (
                                <option key={customer.customer_id} value={customer.customer_id}>
                                    {customer.customer_name || customer.customer_id}
                                </option>
                            ))
                        }
                    </select>
                }

                {
                    mode === "general" &&
                    <select
                        value={selectedAccountId}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        aria-label="Account"
                    >
                        <option value="">All Accounts</option>
                        {
                            accounts
                                .filter(account => account.code !== "1100")
                                .map(account => (
                                    <option key={account.id} value={account.id}>
                                        {account.code} - {account.name}
                                    </option>
                                ))
                        }
                    </select>
                }

                <select
                    value={datePreset}
                    onChange={(e) => setDatePreset(e.target.value as DateRangePresetKey)}
                    aria-label="Date filter"
                >
                    {
                        DATE_RANGE_PRESETS.map(preset => (
                            <option key={preset.key} value={preset.key}>
                                {preset.label}
                            </option>
                        ))
                    }
                </select>

                {
                    datePreset === "custom" &&
                    <div className="date-range-filter">
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            aria-label="Start date"
                        />
                        <span>to</span>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            aria-label="End date"
                        />
                    </div>
                }

            </div>


            <div className="ledger-balance-card">
                <span>Closing Balance</span>
                <h2>{formatCurrency(closingBalance)}</h2>
            </div>


            <div className="accounting-table ledger-table">

                <div className="accounting-table-head ledger-table-row">
                    <span>Date</span>
                    <span>Reference ID</span>
                    <span>Description</span>
                    <span className="amount-column-head">Debit</span>
                    <span className="amount-column-head">Credit</span>
                    <span className="amount-column-head">Balance</span>
                    <span>Notes</span>
                </div>

                {
                    !loading && entries.length === 0 &&
                    <div className="empty-transactions">
                        {
                            mode === "customer" && !selectedCustomerId
                                ? "No customer selected"
                                : "No Ledger Entries Found"
                        }
                    </div>
                }

                {
                    entries.map(entry => (
                        <div key={entry.id} className="accounting-table-row ledger-table-row">

                            <span>{formatDateShort(entry.entry_date)}</span>

                            <span className="transaction-id">{entry.reference_id || "-"}</span>

                            <span title={entry.description ?? ""}>
                                {entry.description || "-"}
                            </span>

                            <span className={entry.debit > 0 ? "amount-income" : ""}>
                                {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                            </span>

                            <span className={entry.credit > 0 ? "amount-expense" : ""}>
                                {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                            </span>

                            <span>{formatCurrency(entry.running_balance)}</span>

                            <span title={entry.notes ?? ""}>{entry.notes || "-"}</span>

                        </div>
                    ))
                }

            </div>

        </div>

    );

}
