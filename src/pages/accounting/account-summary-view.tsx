import { useEffect, useState } from "react";

import { useCurrency } from "../../hooks/use-currency";


const ACCOUNT_TYPE_ORDER: Account["type"][] = [
    "Asset",
    "Liability",
    "Equity",
    "Income",
    "Expense"
];


// Account Summary (Task 10, Section 6). One card per Chart of
// Accounts account: current balance plus lifetime debit/credit
// turnover, grouped by account type. Reuses the existing
// .summary-card visual language from the Transactions tab so it reads
// as part of the same page rather than a bolted-on screen.
export default function AccountSummaryView() {

    const { format: formatCurrency } = useCurrency();

    const [rows, setRows] = useState<AccountSummaryRow[]>([]);
    const [loading, setLoading] = useState(true);


    useEffect(() => {

        window.mooral.ledger.accountSummary()
            .then(setRows)
            .finally(() => setLoading(false));

    }, []);


    const grouped = ACCOUNT_TYPE_ORDER
        .map(type => ({
            type,
            accounts: rows.filter(row => row.type === type)
        }))
        .filter(group => group.accounts.length > 0);


    return (

        <div className="account-summary-view">

            {
                !loading && rows.length === 0 &&
                <div className="empty-transactions">
                    No Accounts Found
                </div>
            }

            {
                grouped.map(group => (

                    <div key={group.type} className="account-summary-group">

                        <h3 className="account-summary-group-title">
                            {group.type} Accounts
                        </h3>

                        <div className="accounting-summary account-summary-cards">

                            {
                                group.accounts.map(account => (

                                    <div
                                        key={account.id}
                                        className={
                                            "summary-card " +
                                            (account.balance >= 0 ? "balance" : "expense")
                                        }
                                    >

                                        <span>
                                            {account.code} - {account.name}
                                        </span>

                                        <h2>
                                            {formatCurrency(Math.abs(account.balance))}
                                        </h2>

                                        <div className="account-summary-turnover">
                                            <span>Debit {formatCurrency(account.totalDebit)}</span>
                                            <span>Credit {formatCurrency(account.totalCredit)}</span>
                                        </div>

                                    </div>

                                ))
                            }

                        </div>

                    </div>

                ))
            }

        </div>

    );

}
