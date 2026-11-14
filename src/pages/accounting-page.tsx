import { useEffect, useMemo, useState } from "react";

import "./accounting.css";

import {
    Plus,
    Search,
    Pencil,
    Trash2,
    X,
    Lock,
    ShieldCheck
} from "lucide-react";



// Transaction is declared globally in src/types/electron.d.ts
// (previously this file redeclared a local copy of the same type).



interface Summary {

    totalIncome: number;

    totalExpense: number;

    balance: number;

    totalTransactions: number;

}



import { useCurrency } from "../hooks/use-currency";
import { useLanguage } from "../hooks/use-language";

import { formatDateShort } from "../utils/date-format";
import { formatNumber } from "../utils/format-number";

import {
    DATE_RANGE_PRESETS,
    getPresetDateRange,
    type DateRangePresetKey
} from "../utils/date-range-presets";

import { useAuth } from "@/hooks/use-auth";

import LedgerView from "./accounting/ledger-view";
import JournalView from "./accounting/journal-view";
import AccountSummaryView from "./accounting/account-summary-view";




const emptyTransaction: Transaction = {


    transaction_id: "",


    type: "Income",


    category: "",


    description: "",


    amount: 0,


    payment_method: "Cash",


    reference_no: "",


    transaction_date:
        new Date()
        .toISOString()
        .split("T")[0],


    notes: ""

};




export default function AccountingPage(){


    const { format: formatCurrency } = useCurrency();
    const { t } = useLanguage();

    const [transactions,setTransactions] =
        useState<Transaction[]>([]);



    const [search,setSearch] =
        useState("");



    const [typeFilter,setTypeFilter] =
        useState("All");


    const [sourceFilter,setSourceFilter] =
        useState("All");


    // Date filter: a single preset drives the filter ("Today", "This Month",
    // etc). "Custom" additionally reveals the start/end date inputs below.
    const [datePreset,setDatePreset] =
        useState<DateRangePresetKey>("all");

    const [customStartDate,setCustomStartDate] =
        useState("");

    const [customEndDate,setCustomEndDate] =
        useState("");

    const { fromDate, toDate } =
        useMemo(
            () => getPresetDateRange(
                datePreset,
                customStartDate,
                customEndDate
            ),
            [datePreset, customStartDate, customEndDate]
        );



    // Which section of the Accounting page is showing. "transactions"
    // is the existing Income/Expense list (default, unchanged
    // behaviour); the other three are the new ledger/journal/summary
    // sections added for Task 10.
    const [activeTab,setActiveTab] =
        useState<"transactions" | "ledger" | "journal" | "summary">(
            "transactions"
        );



    const [showModal,setShowModal] =
        useState(false);



    const [editingId,setEditingId] =
        useState<number|null>(null);



    const [form,setForm] =
        useState<Transaction>(
            emptyTransaction
        );


    const [isSubmitting,setIsSubmitting] =
        useState(false);



    // Accounting access now comes from the real Permission Engine
    // (src/auth/permission-engine.ts) rather than the local
    // Admin/General-User role toggle this page used before Phase 3 --
    // "Never use role == admin" (Master Spec, Permission Engine).
    // canManage covers add/edit/delete uniformly, matching this page's
    // existing single-flag usage at every call site below.
    const { hasPermission } = useAuth();

    const canManage =
        hasPermission("accounting.create") ||
        hasPermission("accounting.edit") ||
        hasPermission("accounting.delete");



    async function loadTransactions(){


        const data =
            await window.mooral.accounting.get(
                (fromDate || toDate)
                    ? { fromDate: fromDate || undefined, toDate: toDate || undefined }
                    : undefined
            );


        setTransactions(data);


    }
	    useEffect(() => {

        loadTransactions();

    }, [fromDate, toDate]);




    function openCreateModal(){


        if(!canManage){
            return;
        }


        setEditingId(null);


        setForm({

            ...emptyTransaction,

            transaction_date:
                new Date()
                .toISOString()
                .split("T")[0]

        });


        setShowModal(true);


    }




    function openEditModal(
        transaction:Transaction
    ){


        if(!canManage){
            return;
        }


        setEditingId(
            transaction.id ?? null
        );


        setForm(transaction);


        setShowModal(true);


    }





    async function saveTransaction(){


        // Defense in depth: the Add/Edit UI is hidden for General Users,
        // but guard the handler itself too in case it's ever reachable.
        if(!canManage){
            return;
        }


        // Prevent a fast double-click (or a slow IPC round trip) from
        // submitting the same transaction twice.
        if(isSubmitting){
            return;
        }


        try{


            if(form.amount <= 0){


                alert(
                    "Amount must be greater than 0"
                );


                return;


            }



            if(!form.category.trim()){


                alert(
                    "Category required"
                );


                return;


            }



            if(!form.description.trim()){


                alert(
                    "Description required"
                );


                return;


            }




            setIsSubmitting(true);


            if(editingId === null){


                await window.mooral.accounting.create(
                    form
                );


            }

            else{


                await window.mooral.accounting.update(

                    editingId,

                    form

                );


            }




            setShowModal(false);


            await loadTransactions();


        }

        catch(error){


            console.error(

                "TRANSACTION SAVE ERROR",

                error

            );


            alert(
                error instanceof Error
                    ? error.message
                    : "Transaction save failed. Please try again."
            );


        }

        finally{

            setIsSubmitting(false);

        }


    }





    async function removeTransaction(
        id:number
    ){


        // Defense in depth: the Delete button is hidden for General
        // Users, but guard the handler itself too in case it's ever
        // reachable.
        if(!canManage){
            return;
        }


        if(
            !confirm(
                "Delete this transaction?"
            )
        ){

            return;

        }



        try{

            await window.mooral.accounting.delete(
                id
            );

            await loadTransactions();

        }
        catch(error){

            console.error(
                "TRANSACTION DELETE ERROR",
                error
            );

            alert(
                error instanceof Error
                    ? error.message
                    : "Could not delete this transaction. Please try again."
            );

        }


    }







    // Summary cards always reflect the active date filter: they are derived
    // straight from `transactions` (already fetched with fromDate/toDate
    // applied) instead of a separate, unfiltered summary() call. This keeps
    // Income / Expense / Balance / Total Transactions consistent with the
    // date range shown, and refreshes instantly whenever it changes.
    const summary =

        useMemo<Summary>(()=>{

            let totalIncome = 0;
            let totalExpense = 0;

            for(const transaction of transactions){

                const amount = Number(transaction.amount ?? 0);

                if(transaction.type === "Income"){
                    totalIncome += amount;
                }
                else if(transaction.type === "Expense"){
                    totalExpense += amount;
                }

            }

            return {
                totalIncome,
                totalExpense,
                balance: totalIncome - totalExpense,
                totalTransactions: transactions.length
            };

        },[transactions]);




    const filteredTransactions =

        useMemo(()=>{


            return transactions.filter(

                (transaction)=>{


                    const text =
                        search.toLowerCase();



                    const matchesSearch =


                        transaction.transaction_id
                        .toLowerCase()
                        .includes(text)


                        ||

                        transaction.description
                        .toLowerCase()
                        .includes(text)


                        ||

                        transaction.category
                        .toLowerCase()
                        .includes(text)


                        ||

                        (transaction.payment_method ?? "")
                        .toLowerCase()
                        .includes(text)


                        ||

                        (transaction.reference_no ?? "")
                        .toLowerCase()
                        .includes(text)


                        ||

                        (transaction.notes ?? "")
                        .toLowerCase()
                        .includes(text);



                    const matchesType =


                        typeFilter === "All"


                        ||


                        transaction.type === typeFilter;



                    const matchesSource =


                        sourceFilter === "All"


                        ||


                        (
                            sourceFilter === "Manual"
                            ?
                            !transaction.source_invoice_id
                            :
                            !!transaction.source_invoice_id
                        );




                    return (

                        matchesSearch

                        &&

                        matchesType

                        &&

                        matchesSource

                    );


                }


            );


        },[

            transactions,

            search,

            typeFilter,

            sourceFilter

        ]);





    return (

        <div className="accounting-page">


            <div className="accounting-header">


                <div>


                    <h1>
                        {t("accounting.title")}
                    </h1>


                    <p>
                        {t("accounting.subtitle")}
                    </p>


                </div>



                <div className="accounting-role-control">


                    <span className="accounting-role-badge">
                        <ShieldCheck size={14}/>
                        {
                            canManage
                                ? "Full Access"
                                : "View Only"
                        }
                    </span>


                    {
                        canManage &&

                        <button

                            className="add-transaction-btn"

                            onClick={openCreateModal}

                        >


                            <Plus size={18}/>


                            {t("accounting.addTransaction")}


                        </button>
                    }


                </div>


            </div>


            <div className="accounting-tabs">

                <button
                    type="button"
                    className={
                        activeTab === "transactions"
                            ? "accounting-tab active"
                            : "accounting-tab"
                    }
                    onClick={() => setActiveTab("transactions")}
                >
                    {t("accounting.tabTransactions")}
                </button>

                <button
                    type="button"
                    className={
                        activeTab === "ledger"
                            ? "accounting-tab active"
                            : "accounting-tab"
                    }
                    onClick={() => setActiveTab("ledger")}
                >
                    {t("accounting.tabLedger")}
                </button>

                <button
                    type="button"
                    className={
                        activeTab === "journal"
                            ? "accounting-tab active"
                            : "accounting-tab"
                    }
                    onClick={() => setActiveTab("journal")}
                >
                    {t("accounting.tabJournal")}
                </button>

                <button
                    type="button"
                    className={
                        activeTab === "summary"
                            ? "accounting-tab active"
                            : "accounting-tab"
                    }
                    onClick={() => setActiveTab("summary")}
                >
                    {t("accounting.tabSummary")}
                </button>

            </div>


            {
                activeTab === "ledger" &&
                <LedgerView canManage={canManage} />
            }

            {
                activeTab === "journal" &&
                <JournalView canManage={canManage} />
            }

            {
                activeTab === "summary" &&
                <AccountSummaryView />
            }


            {
                activeTab === "transactions" &&
                <>


            <div className="accounting-summary">



                <div className="summary-card income">


                    <span>
                        {t("accounting.totalIncome")}
                    </span>


                    <h2>

                        {formatCurrency(Number(summary.totalIncome ?? 0))}

                    </h2>


                </div>





                <div className="summary-card expense">


                    <span>
                        {t("accounting.totalExpense")}
                    </span>


                    <h2>

                        {formatCurrency(Number(summary.totalExpense ?? 0))}

                    </h2>


                </div>





                <div className="summary-card balance">


                    <span>
                        {t("accounting.currentBalance")}
                    </span>


                    <h2>

                        {formatCurrency(Number(summary.balance ?? 0))}

                    </h2>


                </div>





                <div className="summary-card total">


                    <span>
                        {t("accounting.totalTransactions")}
                    </span>


                    <h2>

                        {
                            Number(
                                summary.totalTransactions ?? 0
                            )
                        }

                    </h2>


                </div>



            </div>
			            <div className="accounting-toolbar">


                <div className="search-box">


                    <Search size={18}/>


                    <input


                        type="text"


                        placeholder={t("accounting.searchPlaceholder")}


                        value={search}


                        onChange={(e)=>

                            setSearch(
                                e.target.value
                            )

                        }


                    />


                </div>





                <select


                    value={typeFilter}


                    onChange={(e)=>

                        setTypeFilter(
                            e.target.value
                        )

                    }


                >


                    <option>
                        All
                    </option>


                    <option>
                        Income
                    </option>


                    <option>
                        Expense
                    </option>


                </select>


                <select


                    value={sourceFilter}


                    onChange={(e)=>

                        setSourceFilter(
                            e.target.value
                        )

                    }


                    aria-label="Source filter"


                >


                    <option>
                        All
                    </option>


                    <option>
                        Manual
                    </option>


                    <option>
                        Invoice Generated
                    </option>


                </select>


                <select

                    value={datePreset}

                    onChange={(e)=>
                        setDatePreset(
                            e.target.value as DateRangePresetKey
                        )
                    }

                    aria-label="Date filter"

                >

                    {
                        DATE_RANGE_PRESETS.map(
                            (preset)=>(
                                <option
                                    key={preset.key}
                                    value={preset.key}
                                >
                                    {preset.label}
                                </option>
                            )
                        )
                    }

                </select>

                {
                    datePreset === "custom" &&
                    <div className="date-range-filter">

                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e)=>
                                setCustomStartDate(e.target.value)
                            }
                            aria-label="Start date"
                        />

                        <span>to</span>

                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e)=>
                                setCustomEndDate(e.target.value)
                            }
                            aria-label="End date"
                        />

                    </div>
                }

                {
                    datePreset !== "all" &&
                    <button
                        type="button"
                        className="clear-date-filter"
                        onClick={()=>{
                            setDatePreset("all");
                            setCustomStartDate("");
                            setCustomEndDate("");
                        }}
                    >
                        {t("accounting.clear")}
                    </button>
                }


            </div>








            <div className="accounting-table">



                <div className="accounting-table-head">


                    <span>
                        {t("accounting.id")}
                    </span>


                    <span>
                        {t("accounting.type")}
                    </span>


                    <span>
                        {t("accounting.category")}
                    </span>


                    <span>
                        {t("accounting.description")}
                    </span>


                    <span className="amount-column-head">
                        {t("accounting.amount")}
                    </span>


                    <span>
                        {t("accounting.date")}
                    </span>


                    <span>
                        {t("accounting.action")}
                    </span>



                </div>


                <div className="accounting-table-body table-scroll-body">







                {
                    filteredTransactions.length === 0 &&


                    <div className="empty-transactions">


                        {t("accounting.noTransactionsFound")}


                    </div>


                }







                {

                    filteredTransactions.map(

                        (transaction)=>(


                            <div


                                key={transaction.id}


                                className="accounting-table-row"


                            >





                                <span className="transaction-id">


                                    {
                                        transaction.transaction_id
                                    }


                                   


                                </span>







                                <span>


                                    <span


                                        className={

                                            `transaction-type ${
                                                
                                                transaction.type === "Income"

                                                ?

                                                "type-income"

                                                :

                                                "type-expense"

                                            }`

                                        }


                                    >


                                        {
                                            transaction.type
                                        }


                                    </span>


                                </span>







                                <span>


                                    {
                                        transaction.category
                                    }


                                </span>







                                <span>


                                    {
                                        transaction.description
                                    }


                                </span>







                                <span


                                    className={

                                        transaction.type === "Income"

                                        ?

                                        "amount-income"

                                        :

                                        "amount-expense"

                                    }


                                >



                                    {formatCurrency(Number(transaction.amount ?? 0))}



                                </span>







                                <span>


                                    {
                                        formatDateShort(
                                            transaction.transaction_date
                                        )
                                    }


                                </span>







                                <span>


                                    <div className="transaction-actions">


                                        {
                                            canManage
                                            ?
                                            <>

                                        <button


                                            onClick={()=>

                                                openEditModal(
                                                    transaction
                                                )

                                            }


                                        >


                                            <Pencil size={16}/>


                                        </button>




                                        <button


                                            onClick={()=>

                                                removeTransaction(
                                                    transaction.id!
                                                )

                                            }

                                            disabled={
                                                !!transaction.source_invoice_id
                                            }

                                            title={
                                                transaction.source_invoice_id
                                                    ? "This transaction is automatically generated from an invoice. Edit the invoice instead."
                                                    : undefined
                                            }


                                        >


                                            <Trash2 size={16}/>


                                        </button>

                                            </>
                                            :
                                            <span className="accounting-view-only">
                                                {t("accounting.viewOnly")}
                                            </span>
                                        }


                                    </div>



                                </span>





                            </div>


                        )


                    )


                }





                </div>

            </div>
			            {
                showModal &&


                <div className="modal-overlay">


                    <div className="accounting-modal">



                        <div className="modal-header">


                            <h2>


                                {

                                    editingId === null

                                    ?

                                    t("accounting.addTransaction")

                                    :

                                    t("accounting.editTransaction")

                                }


                            </h2>



                            <button

                                onClick={()=>

                                    setShowModal(false)

                                }

                            >


                                <X size={18}/>


                            </button>


                        </div>








                        {
                            form.source_invoice_id &&

                            <div className="invoice-generated-note">
                                <Lock size={14}/>
                                This transaction is automatically generated from an invoice. Edit the invoice instead.
                            </div>
                        }



                        <div className="accounting-form-grid">





                            <div className="form-field">


                                <label>
                                    {t("accounting.type")}
                                </label>


                                <select


                                    value={form.type}


                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            type:
                                            e.target.value as
                                            "Income" |
                                            "Expense"

                                        })

                                    }

                                    disabled={
                                        !!form.source_invoice_id
                                    }


                                >


                                    <option>
                                        Income
                                    </option>


                                    <option>
                                        Expense
                                    </option>


                                </select>


                            </div>








                            <div className="form-field">


                                <label>
                                    {t("accounting.category")}
                                </label>


                                <input


                                    value={form.category}


                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            category:
                                            e.target.value

                                        })

                                    }

                                    disabled={
                                        !!form.source_invoice_id
                                    }


                                />


                            </div>








                            <div className="form-field full">


                                <label>
                                    {t("accounting.description")}
                                </label>


                                <input


                                    value={form.description}


                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            description:
                                            e.target.value

                                        })

                                    }


                                />


                            </div>








                            <div className="form-field">


                                <label>
                                    {t("accounting.amount")}
                                </label>



                                <input


                                    type="number"



                                    value={

                                        form.amount === 0

                                        ?

                                        ""

                                        :

                                        form.amount

                                    }



                                    onChange={(e)=>


                                        setForm({

                                            ...form,


                                            amount:

                                                e.target.value === ""

                                                ?

                                                0

                                                :

                                                Number(
                                                    e.target.value
                                                )

                                        })


                                    }



                                />


                            </div>








                            <div className="form-field">


                                <label>
                                    {t("accounting.paymentMethod")}
                                </label>



                                <select


                                    value={form.payment_method}



                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            payment_method:
                                            e.target.value

                                        })

                                    }


                                >


                                    <option>
                                        Cash
                                    </option>


                                    <option>
                                        Bank
                                    </option>


                                    <option>
                                        Card
                                    </option>


                                    <option>
                                        Mobile Banking
                                    </option>


                                </select>


                            </div>








                            <div className="form-field">


                                <label>
                                    {t("accounting.referenceNo")}
                                </label>



                                <input


                                    value={
                                        form.reference_no
                                    }


                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            reference_no:
                                            e.target.value

                                        })

                                    }

                                    disabled={
                                        !!form.source_invoice_id
                                    }


                                />


                            </div>








                            <div className="form-field">


                                <label>
                                    {t("accounting.date")}
                                </label>



                                <input


                                    type="date"



                                    value={
                                        form.transaction_date
                                    }



                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            transaction_date:
                                            e.target.value

                                        })

                                    }


                                />


                            </div>








                            <div className="form-field full">


                                <label>
                                    {t("accounting.notes")}
                                </label>



                                <textarea


                                    value={
                                        form.notes
                                    }



                                    onChange={(e)=>

                                        setForm({

                                            ...form,

                                            notes:
                                            e.target.value

                                        })

                                    }


                                />



                            </div>



                        </div>









                        <div className="modal-footer">


                            <button


                                className="cancel-btn"



                                onClick={()=>

                                    setShowModal(false)

                                }


                            >


                                {t("common.cancel")}


                            </button>








                            <button


                                className="save-btn"



                                onClick={saveTransaction}

                                disabled={isSubmitting}


                            >



                                {

                                    isSubmitting

                                    ?

                                    "Saving..."

                                    :

                                    editingId === null

                                    ?

                                    t("accounting.saveTransaction")

                                    :

                                    t("accounting.updateTransaction")

                                }



                            </button>



                        </div>






                    </div>


                </div>

            }

                </>
            }


        </div>


    );


}