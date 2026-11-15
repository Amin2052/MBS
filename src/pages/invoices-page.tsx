import {
  Search,
  X,
  Pencil,
  Trash2,
  Printer,
  FileDown,
  Eye
} from "lucide-react";

import { useEscapeKey } from "@/hooks/use-escape-key";


import {
  useEffect,
  useMemo,
  useState
} from "react";


import "./invoices.css";


import { useLanguage } from "@/hooks/use-language";
import { formatDateShort } from "@/utils/date-format";
import { formatNumber } from "@/utils/format-number";
import { useCurrency } from "@/hooks/use-currency";
import { CURRENCIES } from "@/constants/currency";
import { getCompanySettings } from "@/services/company-settings-service";
import QRCode from "qrcode";
import { MOORAL_LOGO_DATA_URL } from "@/assets/mooral-logo-data-url";
import { showPrintPreview, buildPrintDocumentLabel } from "@/utils/print-window";



// Amount formatting helpers (formatAmount / formatPlainAmount /
// formatFullAmount) are defined inside the InvoicesPage component so
// they follow the user's selected currency (see useCurrency()) instead
// of being hardcoded to BDT.
// Customer and Product are declared globally in src/types/electron.d.ts
// (previously this file redeclared local copies of both). Invoice and
// InvoiceItem stay local: their fields intentionally allow string values
// (e.g. quantity/price) while an item row is being typed into, which the
// global types (used by the IPC layer) correctly don't allow.



type InvoiceItem = {

  product_id?:string;

  product_name:string;

  quantity:number|string;

  price:number|string;

  total:number;

};




type Invoice = {

  id?:number;

  invoice_id:string;

  customer_id?:string;

  customer_name:string;

  items?:InvoiceItem[];

  subtotal:number;

  discount:number;

  tax:number;

  total:number;

  paid:number;

  due:number;

  payment_method:string;

  status:string;

  invoice_date:string;

  due_date?:string;

  notes?:string;

  created_at?:string;

};




type InvoiceSummary = {

  totalInvoices:number;

  totalAmount:number;

  totalPaid:number;

  totalDue:number;

  paidCount:number;

  unpaidCount:number;

  partialCount:number;

  overdueCount:number;

};



const STATUS_OPTIONS = [

  "Unpaid",

  "Partial",

  "Paid",

  "Overdue",

  "Cancelled"

];




const emptyItem = ():InvoiceItem => ({

  product_id:"",

  product_name:"",

  quantity:1,

  price:0,

  total:0

});




export default function InvoicesPage(): JSX.Element {


  const { t } = useLanguage();

  // Defensive against any invoice.status value that doesn't exactly
  // match one of the known STATUS_OPTIONS keys (e.g. older/imported
  // data, a manual DB edit, or any other unexpected status text) --
  // translate() falls back to returning the raw dotted key itself when
  // a key can't be resolved, which would otherwise show something like
  // "invoices.status.Partial Paid" in the status badge instead of
  // readable text. Falls back to the raw status string, never the key.
  function getInvoiceStatusLabel(status: string): string {
    const translated = t(`invoices.status.${status}`);
    return translated === `invoices.status.${status}` ? status : translated;
  }

  const { currency } = useCurrency();
  const CURRENCY_SYMBOL = CURRENCIES[currency].symbol;

  function formatAmount(value: number | string): string {

    return `${CURRENCY_SYMBOL} ${formatNumber(value)}`;

  }

  function formatPlainAmount(value: number | string): string {

    return formatNumber(value);

  }

  function formatFullAmount(value: number | string): string {

    const numeric = Number(value) || 0;

    const isNegative = numeric < 0;

    const absolute = Math.abs(numeric);

    const hasFraction =
      Math.abs(absolute - Math.round(absolute)) > 0.004;


    const formatted = hasFraction
      ? absolute.toLocaleString(
          "en-US",
          {
            minimumFractionDigits:2,
            maximumFractionDigits:2
          }
        )

      : Math.round(absolute).toLocaleString("en-US");


    return `${CURRENCY_SYMBOL} ${isNegative ? "-" : ""}${formatted}`;

  }



  function formatFullPlainAmount(value: number | string): string {

    const numeric = Number(value) || 0;

    const isNegative = numeric < 0;

    const absolute = Math.abs(numeric);

    const hasFraction =
      Math.abs(absolute - Math.round(absolute)) > 0.004;

    const formatted = hasFraction
      ? absolute.toLocaleString(
          "en-US",
          {
            minimumFractionDigits:2,
            maximumFractionDigits:2
          }
        )

      : Math.round(absolute).toLocaleString("en-US");

    return `${isNegative ? "-" : ""}${formatted}`;

  }



  const [invoices,setInvoices] =
    useState<Invoice[]>([]);



  const [customers,setCustomers] =
    useState<Customer[]>([]);



  const [summary,setSummary] =
    useState<InvoiceSummary|null>(null);



  const [search,setSearch] =
    useState("");



  const [statusFilter,setStatusFilter] =
    useState("All");



  const [fromDate,setFromDate] =
    useState("");



  const [toDate,setToDate] =
    useState("");



  const [showModal,setShowModal] =
    useState(false);

  useEscapeKey(showModal, () => setShowModal(false));



  const [editId,setEditId] =
    useState<number|null>(null);



  const [viewInvoice,setViewInvoice] =
    useState<Invoice|null>(null);


  const [isSubmitting,setIsSubmitting] =
    useState(false);


  // Inline validation/save message for the edit dialog, matching the other
  // data-entry dialogs -- no native alert() boxes.
  const [formError,setFormError] =
    useState<string|null>(null);




  const [form,setForm] = useState({

    customer_id:"",

    customer_name:"",

    discount:"0",

    tax:"0",

    paid:"0",

    payment_method:"Cash",

    status:"Unpaid",

    invoice_date:
      new Date().toISOString().slice(0,10),

    due_date:"",

    notes:""

  });



  const [items,setItems] =
    useState<InvoiceItem[]>([emptyItem()]);
	  async function loadInvoices(){

    const data = await window.mooral.invoices.getAll();

    setInvoices(data);

  }




  async function loadSummary(){

    const data = await window.mooral.invoices.summary();

    setSummary(data);

  }




  async function loadCustomers(){

    const data = await window.mooral.customers.getAll();

    setCustomers(data);

  }








  useEffect(()=>{

    loadInvoices();

    loadSummary();

    loadCustomers();


  },[]);







  const filteredInvoices =

    useMemo(()=>{


      const keyword =
        search
        .trim()
        .toLowerCase();



      return invoices.filter(invoice=>{


        const matchesKeyword =

          !keyword

          ||

          invoice.invoice_id
            .toLowerCase()
            .includes(keyword)

          ||

          invoice.customer_name
            .toLowerCase()
            .includes(keyword);




        const matchesStatus =

          statusFilter === "All"

          ||

          invoice.status === statusFilter;




        const invoiceDate =

          (invoice.invoice_date || "")
          .slice(0,10);




        const matchesFrom =

          !fromDate

          ||

          invoiceDate >= fromDate;




        const matchesTo =

          !toDate

          ||

          invoiceDate <= toDate;




        return (

          matchesKeyword

          &&

          matchesStatus

          &&

          matchesFrom

          &&

          matchesTo

        );


      });



    },[
      invoices,
      search,
      statusFilter,
      fromDate,
      toDate
    ]);








  const subtotal =

    useMemo(()=>{


      return items.reduce(

        (sum,item)=>

          sum +

          (Number(item.quantity)||0)

          *

          (Number(item.price)||0),


        0

      );


    },[items]);







  const total =

    useMemo(()=>{


      const discount =
        Number(form.discount)||0;



      const tax =
        Number(form.tax)||0;



      return Math.max(

        0,

        subtotal - discount + tax

      );



    },[
      subtotal,
      form.discount,
      form.tax
    ]);







  const due =

    useMemo(()=>{


      const paid =
        Number(form.paid)||0;



      return Math.max(

        0,

        total - paid

      );



    },[
      total,
      form.paid
    ]);



  function editInvoice(invoice:Invoice){


    setEditId(invoice.id || null);



    setForm({

      customer_id:
        invoice.customer_id || "",


      customer_name:
        invoice.customer_name,


      discount:
        String(invoice.discount ?? 0),


      tax:
        String(invoice.tax ?? 0),


      paid:
        String(invoice.paid ?? 0),


      payment_method:
        invoice.payment_method || "Cash",


      status:
        invoice.status || "Unpaid",


      invoice_date:

        invoice.invoice_date

          ? invoice.invoice_date.slice(0,10)

          : new Date()
              .toISOString()
              .slice(0,10),


      due_date:

        invoice.due_date

          ? invoice.due_date.slice(0,10)

          : "",


      notes:
        invoice.notes || ""

    });




    setItems(

      invoice.items && invoice.items.length

        ? invoice.items

        : [emptyItem()]

    );



    setFormError(null);


    setShowModal(true);

  }








  async function saveInvoice(){


    setFormError(null);


    if(!form.customer_name.trim()){

      setFormError(t("invoices.validationCustomer"));

      return;

    }





    const validItems = items

      .filter(
        item =>
          item.product_name.trim()
      )

      .map(item=>{


        const quantityIsEmpty =

          item.quantity === ""

          ||

          item.quantity === undefined

          ||

          item.quantity === null

          ||

          Number.isNaN(
            Number(item.quantity)
          );



        const priceIsEmpty =

          item.price === ""

          ||

          item.price === undefined

          ||

          item.price === null

          ||

          Number.isNaN(
            Number(item.price)
          );




        const quantity =

          quantityIsEmpty

            ? 1

            : Number(item.quantity);




        const price =

          priceIsEmpty

            ? 0

            : Number(item.price);




        return {

          ...item,

          quantity,

          price,

          total:
            quantity * price

        };


      });






    if(validItems.length === 0){


      setFormError(
        t("invoices.validationItems")
      );


      return;


    }







    const invoice = {


      customer_id:
        form.customer_id,


      customer_name:
        form.customer_name,


      items:
        validItems,



      subtotal,



      discount:
        Number(form.discount)||0,



      tax:
        Number(form.tax)||0,



      total,



      paid:
        Number(form.paid)||0,



      due,



      payment_method:
        form.payment_method,



      status:
        form.status,



      invoice_date:
        form.invoice_date,



      due_date:
        form.due_date || undefined,



      notes:
        form.notes


    };







    // Prevent a fast double-click (or a slow IPC round trip) from
    // submitting the same invoice twice, which would double-deduct stock.
    if(isSubmitting){
      return;
    }


    setIsSubmitting(true);


    try{

      if(!editId){
        throw new Error("No invoice selected to update.");
      }

      await window.mooral.invoices.update({
        id:editId,
        invoice
      });

    }
    catch(error){

      console.error("Failed to save invoice:", error);

      setFormError(
        error instanceof Error
          ? error.message
          : t("invoices.saveFailed")
      );

      return;

    }
    finally{

      setIsSubmitting(false);

    }



    setShowModal(false);



    await loadInvoices();



    await loadSummary();





  }









  async function removeInvoice(id:number){


    if(
      !window.confirm(
        t("invoices.confirmDelete")
      )
    )
      return;




    try{

      await window.mooral.invoices.delete(id);

      await loadInvoices();


    }
    catch(error){

      console.error("Failed to delete invoice:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : t("invoices.deleteFailed")
      );

    }



    await loadSummary();



  }







  function tf(
  key:string,
  fallback:string
): string {

  const value = t(key);

  return value && value !== key
    ? value
    : fallback;

}







  function escapeHtml(value:string){


    return String(value ?? "")

      .replace(/&/g,"&amp;")

      .replace(/</g,"&lt;")

      .replace(/>/g,"&gt;")

      .replace(/"/g,"&quot;")

      .replace(/'/g,"&#39;");


  }


  // Builds the approved A4 invoice PDF HTML used by print and export.
  //
  // `includeFooter` defaults to true (used by the on-screen preview and
  // the native print flow, where the footer must be embedded in the
  // document itself as a normal in-flow block -- see .footer in the
  // <style> below). PDF export passes false: it supplies its own
  // repeating footer via Chromium's footerTemplate mechanism instead
  // (see exportPdf() below and the "invoices:exportPdf" handler in
  // electron/main/main.ts), so embedding this in-flow one too would
  // print it twice.
  //
  // Footer-positioning investigation notes (why it's in-flow here, not
  // pinned to the page bottom): two techniques were tried and ruled
  // out by actually rendering multi-page output through real Chromium
  // and inspecting it, rather than assumed from CSS alone --
  //   1. position:fixed does NOT repeat per printed page in Chromium's
  //      PDF pipeline, contrary to common assumption from browser
  //      @media print tutorials. It renders exactly once, wherever it
  //      happens to fall in the flow -- not once per page.
  //   2. Reserving space via a CSS @page bottom margin has no effect
  //      on pagination during printToPDF/native print when it's the
  //      ONLY margin declared: if the HTML's own @page rule declares a
  //      margin at all, THAT wins over the PDF-export call's explicit
  //      margin option for pagination purposes, silently defeating any
  //      reserved footer space.
  // Keeping the footer in-flow (once, right after the content) is the
  // one approach that can never overlap a row for this shared preview/
  // print HTML. The actual "pinned to the true bottom of every PDF
  // page" requirement is solved separately, only for the PDF export
  // path (includeFooter=false), using Chromium's purpose-built
  // repeating-footer mechanism (printToPDF's displayHeaderFooter/
  // footerTemplate + a reserved bottom margin, see the "invoices:
  // exportPdf" handler in electron/main/main.ts) which renders in its
  // own per-page layer that Chromium guarantees repeats without
  // overlapping flowing content -- not achievable with pure
  // in-document HTML/CSS. For that to work the exported HTML must NOT
  // declare its own @page margin (point 2 above), which is why @page
  // and the .page/html/body min-height below are conditional on
  // includeFooter: forcing a fixed 297mm min-height while the PDF call
  // has also reserved bottom margin space would make the content box
  // taller than the actual printable area on every export and force a
  // spurious near-blank extra page -- confirmed by rendering a
  // one-line invoice and finding an unwanted second page.
  async function buildInvoiceHtml(invoice:Invoice, includeFooter = true): Promise<string|null> {

    const company = await getCompanySettings();
    // Logo bug fix: this used to hardcode MOORAL_LOGO_DATA_URL unconditionally,
    // so a tenant's own uploaded company logo was never read and invoices
    // always showed the default Mooral branding regardless of what was
    // saved in Settings > Company Profile. Same fallback pattern already
    // used by Reports/Certificates: fetch the real uploaded logo (database
    // is the source of truth, logoPath is only a legacy fallback inside
    // getLogoPreview) and only fall back to the Mooral logo when nothing
    // has been uploaded yet.
    const rawLogoDataUrl = await window.mooral.settings.getLogoPreview(company.logoPath ?? undefined);
    const logoDataUrl = rawLogoDataUrl ?? MOORAL_LOGO_DATA_URL;
    const qrStatus = String(invoice.status || "Unpaid").toLowerCase().replace(/^./, c => c.toUpperCase());
    const qrPayload = `Invoice: ${invoice.invoice_id} | Date: ${formatDateShort(invoice.invoice_date)} | Customer: ${invoice.customer_name} | Total: ${formatFullAmount(invoice.total)} | Status: ${qrStatus}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 180 });

    const companyName = company.companyName || "Mooral Business Suite";
    const companyAddress = company.address || "House 14, Road 6, Dhanmondi, Dhaka - 1209, Bangladesh";
    const companyPhone = company.phone || "+880 1700 000000";
    const companyEmail = company.email || "accounts@mooralsuite.com";
    const customer = customers.find(
  c =>
    String(c.id ?? c.customer_id) ===
    String(invoice.customer_id)
);
    const customerAddress = customer?.address || "";
    const customerEmail = customer?.email || "";
    const customerPhone = customer?.phone || "";
    const status = String(invoice.status || "Unpaid").toUpperCase();
    const dueDate = invoice.due_date
  ? formatDateShort(invoice.due_date)
  : "-";

    const itemsRows = (invoice.items || []).map(item => `
      <tr>
        <td>${escapeHtml(item.product_name)}</td>
        <td>${escapeHtml(String(item.quantity))}</td>
        <td>${escapeHtml(formatFullAmount(item.price))}</td>
        <td>Pcs</td>
        <td>${escapeHtml(formatFullAmount(item.total))}</td>
      </tr>
    `).join("");

    return `
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(invoice.invoice_id)}</title>
<style>
  ${includeFooter ? '@page { size:A4 portrait; margin:0; }' : '@page { size:A4 portrait; }'}
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; width:210mm; ${includeFooter ? 'min-height:297mm;' : ''} background:#fff; }
  body { font-family:Arial,Helvetica,sans-serif; color:#17233a; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { width:210mm; ${includeFooter ? 'min-height:297mm;' : ''} padding:6mm 6mm 7mm; position:relative; break-inside:auto; page-break-inside:auto; }
  .sheet { width:198mm; margin:0 auto; }
  .header { display:flex; align-items:center; gap:1.75mm; padding-bottom:4.2mm; border-bottom:.35mm solid #e4e7ec; }
  .logo { width:27mm; height:27mm; object-fit:contain; flex:0 0 auto; }
  .brand { min-width:0; }
  .brand h1 { margin:0 0 1.2mm; font-size:16.2pt; line-height:1.05; font-weight:700; color:#17294f; }
  .brand p { margin:.7mm 0 0; font-size:8pt; line-height:1.1; color:#75819a; }
  .cards { display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin-top:6.2mm; }
  .card { border:.35mm solid #e0e5eb; border-radius:1.3mm; overflow:hidden; min-height:36mm; }
  .card-title { height:8.3mm; padding:2.8mm 3.5mm; background:#edf2f7; font-size:8.1pt; font-weight:700; color:#18233a; }
  .card-body { padding:3.3mm 3.5mm 3.7mm; }
  .bill-name { font-size:10.2pt; font-weight:700; margin-bottom:4.2mm; }
  .kv { display:grid; grid-template-columns:18mm 1fr; gap:1.7mm; margin-bottom:3mm; font-size:8pt; line-height:1.12; }
  .kv .label { color:#9aa6bb; }
  .kv .value { color:#17233a; font-weight:700; text-align:right; }
  .invoice-info .kv { grid-template-columns:24mm 1fr; }
  .status-text { font-weight:700; color:#17233a; }
  .items-head { display:flex; justify-content:space-between; align-items:center; margin-top:6mm; margin-bottom:3mm; font-size:8.4pt; font-weight:700; }
  .items { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  .items th { background:#edf2f7; color:#17233a; padding:2.7mm 2mm; font-size:7.7pt; font-weight:700; text-align:center; }
  .items th:nth-child(1) { width:40%; }
  .items th:nth-child(2) { width:12%; }
  .items th:nth-child(3) { width:18%; }
  .items th:nth-child(4) { width:10%; }
  .items th:nth-child(5) { width:20%; }
  .items td { padding:3.2mm 2mm; font-size:7.7pt; text-align:center; color:#25324a; vertical-align:middle; }
  .items td:first-child { text-align:center; }
  .items tr:nth-child(even) td { background:#f7f8fa; }
  .items thead { display:table-header-group; }
  .items tbody tr { page-break-inside:avoid; break-inside:avoid; }
  .lower { display:grid; grid-template-columns:45mm minmax(0,1fr); column-gap:5mm; align-items:center; margin-top:6.6mm; }
  .qr-wrap { text-align:center; align-self:center; transform:translateX(13mm); }
  .qr { width:21mm; height:21mm; display:block; margin:0 auto 2mm; image-rendering:auto; }
  .qr-caption { font-size:6.8pt; color:#a4aec0; letter-spacing:.2px; }
  .summary { width:62mm; max-width:100%; justify-self:end; margin-left:0; border:.35mm solid #dfe5eb; border-radius:.7mm; overflow:hidden; }
  .sum-row { display:grid; grid-template-columns:1fr auto; padding:2.9mm 3.2mm; border-bottom:.25mm solid #e5e8ed; font-size:8pt; }
  .sum-row:last-child { border-bottom:0; }
  .sum-label { color:#66738a; }
  .sum-value { color:#17233a; text-align:right; }
  .sum-row.total { font-weight:700; font-size:9.2pt; }
  /* See the "footer positioning" comment above buildInvoiceHtml() for
     why this is a plain in-flow block rather than position:fixed. */
  .footer { margin-top:6mm; width:198mm; padding-top:3.6mm; border-top:.35mm solid #e4e7ec; text-align:center; color:#a8b2c3; font-size:6.8pt; }
</style>
</head>
<body>
<div class="page"><div class="sheet">
  <header class="header">
    <img class="logo" src="${logoDataUrl}" alt="Company logo"/>
    <div class="brand">
      <h1>${escapeHtml(companyName)}</h1>
      <p>${escapeHtml(companyAddress)}</p>
      <p>${escapeHtml(companyPhone)} &nbsp;|&nbsp; ${escapeHtml(companyEmail)}</p>
    </div>
  </header>

  <section class="cards">
    <div class="card bill-to">
      <div class="card-title">BILL TO</div>
      <div class="card-body">
        <div class="bill-name">${escapeHtml(invoice.customer_name)}</div>
        <div class="kv"><div class="label">Address</div><div class="value">${escapeHtml(customerAddress)}</div></div>
        <div class="kv"><div class="label">Email</div><div class="value">${escapeHtml(customerEmail)}</div></div>
        <div class="kv"><div class="label">Phone</div><div class="value">${escapeHtml(customerPhone)}</div></div>
      </div>
    </div>
    <div class="card invoice-info">
      <div class="card-title">INVOICE INFO</div>
      <div class="card-body">
        <div class="kv"><div class="label">Invoice No.</div><div class="value">${escapeHtml(invoice.invoice_id)}</div></div>
        <div class="kv"><div class="label">Invoice Date</div><div class="value">${escapeHtml(formatDateShort(invoice.invoice_date))}</div></div>
        <div class="kv"><div class="label">Due Date</div><div class="value">${escapeHtml(dueDate)}</div></div>
        <div class="kv"><div class="label">Payment Method</div><div class="value">${escapeHtml(invoice.payment_method || "Bank Transfer")}</div></div>
        <div class="kv"><div class="label">Status</div><div class="value status-text">${escapeHtml(status)}</div></div>
      </div>
    </div>
  </section>

  <div class="items-head"><span>Invoice Items</span><span>${(invoice.items || []).length} items</span></div>
  <table class="items"><thead><tr>
    <th>Item &amp; Description</th><th>Qty</th><th>Rate</th><th>Per</th><th>Amount</th>
  </tr></thead><tbody>${itemsRows}</tbody></table>

  <section class="lower">
    <div class="qr-wrap"><img class="qr" src="${qrDataUrl}" alt="Verification QR"/><div class="qr-caption">SCAN TO VERIFY</div></div>
    <div class="summary">
      <div class="sum-row"><div class="sum-label">Subtotal</div><div class="sum-value">${escapeHtml(formatFullAmount(invoice.subtotal))}</div></div>
      <div class="sum-row">
  <div class="sum-label">Discount</div>
  <div class="sum-value">
    ${escapeHtml(formatFullAmount(invoice.discount))}
  </div>
</div>
      <div class="sum-row">
  <div class="sum-label">Tax</div>
  <div class="sum-value">
    ${escapeHtml(formatFullAmount(invoice.tax))}
  </div>
</div>
      <div class="sum-row"><div class="sum-label">Paid</div><div class="sum-value">${escapeHtml(formatFullAmount(invoice.paid))}</div></div>
      <div class="sum-row"><div class="sum-label">Due</div><div class="sum-value">${escapeHtml(formatFullAmount(invoice.due))}</div></div>
      <div class="sum-row total"><div>Total</div><div class="sum-value">${escapeHtml(formatFullAmount(invoice.total))}</div></div>
    </div>
  </section>
</div>${includeFooter ? '<div class="footer">This document is automatically system generated.</div>' : ''}</div>
</body></html>`;
  }



  async function printInvoice(invoice:Invoice){

    const html =
      await buildInvoiceHtml(invoice);

    if(!html){
      window.alert(t("invoices.printingUnavailable"));
      return;
    }



    const result = await showPrintPreview({
      html,
      documentLabel: buildPrintDocumentLabel("Invoice", invoice.invoice_id)
    });

    if (result !== "printed") {
      return;
    }

    try{

        await window.mooral.notifications.create({
            module: "Invoice",
            action: "Printed",
            message: "Invoice Printed",
            after: invoice.invoice_id
        });

    }
    catch(error){

        console.error(
            "NOTIFICATION LOG ERROR",
            error
        );

    }


  }








  async function exportPdf(invoice:Invoice){


    try{

      // includeFooter:false -- the exported PDF gets its footer from
      // Chromium's repeating footerTemplate mechanism instead (see the
      // "invoices:exportPdf" handler in electron/main/main.ts), which
      // is the only reliable way to pin it to the bottom of every page
      // without risking overlap on multi-page invoices.
      const html =
        await buildInvoiceHtml(invoice, false);

      if(!html){
        window.alert(t("invoices.pdfExportUnavailable"));
        return;
      }


      const result =
        await window.mooral.invoices.exportPdf({

          html,

          fileName:
            `${invoice.invoice_id}.pdf`

        });

      if(!result?.success){

        // Only alert on a genuine failure -- cancelling the save
        // dialog is a normal, silent no-op.
        if(!result?.cancelled){
          window.alert(
            result?.error
              ? `${t("invoices.exportFailedPrefix")}${result.error}`
              : t("invoices.exportFailed")
          );
        }

        return;

      }

    }
    catch(error){

      console.error("Failed to export invoice PDF:", error);

      window.alert(t("invoices.exportFailed"));

    }


  }







  return (

    <div className="invoices-page">


      <div className="invoices-header">


        <div>


          <h1>

            {t("invoices.title")}

          </h1>



          <p>

            {t("invoices.subtitle")}

          </p>



        </div>








      </div>







      {
        summary && (


          <div className="invoice-stats-grid">



            <div className="invoice-stat-card">

              <span>

                {t("invoices.totalInvoices")}

              </span>


              <h2>

                {summary.totalInvoices}

              </h2>


            </div>






            <div className="invoice-stat-card">


              <span>

                {t("invoices.totalBilled")}

              </span>


              <h2>

                {formatAmount(
                  summary.totalAmount
                )}

              </h2>


            </div>







            <div className="invoice-stat-card">


              <span>

                {t("invoices.totalCollected")}

              </span>



              <h2>

                {formatAmount(
                  summary.totalPaid
                )}

              </h2>


            </div>








            <div className="invoice-stat-card due">


              <span>

                {t("invoices.totalDue")}

              </span>



              <h2>

                {formatAmount(
                  summary.totalDue
                )}

              </h2>


            </div>






          </div>


        )

      }


      <div className="invoice-toolbar">


        <div className="filter-field filter-search">


          <label>

            {t("common.search")}

          </label>



          <div className="search-box">


            <Search size={18}/>



            <input

              placeholder={
                t("invoices.searchPlaceholder")
              }

              value={search}

              onChange={
                (e)=>
                setSearch(e.target.value)
              }

            />



          </div>



        </div>






        <div className="filter-field">


          <label>

            {t("common.status")}

          </label>



          <select

            value={statusFilter}

            onChange={
              (e)=>
              setStatusFilter(
                e.target.value
              )
            }

          >


            <option value="All">

              {t("common.all")}

            </option>



            {
              STATUS_OPTIONS.map(status=>(

                <option

                  key={status}

                  value={status}

                >

                  {t(
                    `invoices.status.${status}`
                  )}

                </option>


              ))

            }



          </select>



        </div>







        <div className="filter-field">


          <label>

            {t("common.fromDate")}

          </label>



          <input

            type="date"

            value={fromDate}

            onChange={
              (e)=>
              setFromDate(
                e.target.value
              )
            }

          />



        </div>







        <div className="filter-field">


          <label>

            {t("common.toDate")}

          </label>



          <input

            type="date"

            value={toDate}

            onChange={
              (e)=>
              setToDate(
                e.target.value
              )
            }

          />



        </div>




      </div>







      <div className="invoice-table">


        <div className="invoice-table-head">


          <span>

            {t("invoices.invoiceId")}

          </span>


          <span>

            {t("common.customer")}

          </span>


          <span>

            {t("common.date")}

          </span>


          <span>

            {t("common.total")}

          </span>


          <span>

            {t("common.due")}

          </span>


          <span>

            {t("common.status")}

          </span>


          <span>

            {t("common.actions")}

          </span>



        </div>


        <div className="invoice-table-body">



        {
          filteredInvoices.map(invoice=>(


            <div

              className="invoice-table-row"

              key={invoice.id}

            >



              <span className="invoice-id-cell">

                {invoice.invoice_id}

              </span>





              <span>

                {invoice.customer_name}

              </span>





              <span>

                {formatDateShort(
                  invoice.invoice_date
                )}

              </span>





              <span className="amount-cell">


                {formatAmount(
                  invoice.total
                )}


              </span>





              <span className="amount-cell">


                {formatAmount(
                  invoice.due
                )}


              </span>





              <span>


                <span

                  className={
                    `invoice-status status-${
                      invoice.status.toLowerCase()
                    }`
                  }

                >

                  {
                    getInvoiceStatusLabel(invoice.status)
                  }


                </span>



              </span>






              <span className="invoice-actions">


                <button

                  onClick={
                    ()=>setViewInvoice(invoice)
                  }

                  title={
                    t("common.view")
                  }

                >

                  <Eye size={16}/>


                </button>





                <button

                  onClick={
                    ()=>editInvoice(invoice)
                  }

                  title={
                    t("common.edit")
                  }

                >

                  <Pencil size={16}/>


                </button>





                <button

                  onClick={
                    ()=>printInvoice(invoice)
                  }

                  title={
                    t("common.print")
                  }

                >

                  <Printer size={16}/>


                </button>





                <button

                  onClick={
                    ()=>exportPdf(invoice)
                  }

                  title={
                    t("common.exportPdf")
                  }

                >

                  <FileDown size={16}/>


                </button>





                <button

                  onClick={
                    ()=>removeInvoice(invoice.id!)
                  }

                  title={
                    t("common.delete")
                  }

                >

                  <Trash2 size={16}/>


                </button>



              </span>



            </div>


          ))

        }





        {
          filteredInvoices.length === 0 && (


            <div className="empty-invoices">


              {t("invoices.noInvoices")}


            </div>


          )

        }



        </div>

      </div>
      {
        showModal && (


          <div className="modal-overlay">


            <div className="invoice-modal">



              <div className="modal-header">


                <h2>

                  {t("invoices.editInvoice")}

                </h2>



                <button

                  onClick={
                    ()=>setShowModal(false)
                  }

                >

                  <X size={20}/>


                </button>


              </div>






              <div className="invoice-form-grid">



                <div className="form-field">


                  <label>

                    {t("common.customer")}

                  </label>




                  <div className="form-field-readonly">

                    {form.customer_name || "—"}

                  </div>



                </div>







                <div className="form-field">


                  <label>

                    {t("common.status")}

                  </label>




                  <select

                    value={form.status}

                    onChange={
                      (e)=>

                      setForm({

                        ...form,

                        status:
                          e.target.value

                      })

                    }

                  >


                    {

                      STATUS_OPTIONS.map(status=>(


                        <option

                          key={status}

                          value={status}

                        >

                          {
                            t(
                              `invoices.status.${status}`
                            )
                          }


                        </option>


                      ))

                    }


                  </select>



                </div>







                <div className="form-field">


                  <label>

                    {t("common.invoiceDate")}

                  </label>





                  <div className="form-field-readonly">

                    {formatDateShort(form.invoice_date)}

                  </div>



                </div>








                <div className="form-field">


                  <label>

                    {t("common.dueDate")}

                  </label>



                  <input

                    type="date"

                    value={form.due_date}

                    onChange={
                      (e)=>

                      setForm({

                        ...form,

                        due_date:
                          e.target.value

                      })

                    }

                  />


                </div>







                <div className="form-field">


                  <label>

                    {t("common.paymentMethod")}

                  </label>




                  <select

                    value={
                      form.payment_method
                    }

                    onChange={
                      (e)=>

                      setForm({

                        ...form,

                        payment_method:
                          e.target.value

                      })

                    }

                  >


                    <option value="Cash">

                      Cash

                    </option>


                    <option value="Card">

                      Card

                    </option>


                    <option value="Bank Transfer">

                      Bank Transfer

                    </option>


                    <option value="Mobile Banking">

                      Mobile Banking

                    </option>


                    <option value="Other">

                      Other

                    </option>



                  </select>



                </div>



              </div>







              <div className="invoice-items-section">


                <div className="invoice-items-head">


                  <span>

                    {t("common.item")}

                  </span>


                  <span>

                    {t("common.quantity")}

                  </span>


                  <span>

                    {t("common.price")}

                  </span>


                  <span>

                    {t("common.total")}

                  </span>


                  <span></span>


                </div>








                {
                  items.map((item,index)=>(


                    <div
                      className="invoice-item-row invoice-item-row-readonly"
                      key={index}
                    >


                      <span>
                        {item.product_name}
                      </span>


                      <span>
                        {item.quantity}
                      </span>


                      <span>
                        {formatFullPlainAmount(item.price)}
                      </span>


                      <span className="item-total">
                        {formatFullPlainAmount(item.total)}
                      </span>


                      <span></span>


                    </div>


                  ))
                }

              </div>
              <div className="invoice-totals-section">


                <div className="invoice-summary-card">


                  <h3>
                    {tf(
                      "invoices.summaryTitle",
                      "Invoice Summary"
                    )}
                  </h3>


                  <div className="invoice-summary-grid">


                    <div className="invoice-summary-cell">

                      <label>
                        {t("common.subtotal")}
                      </label>

                      <div className="invoice-summary-infobox">
                        {formatFullAmount(subtotal)}
                      </div>

                    </div>


                    <div className="invoice-summary-cell">

                      <label>
                        {t("common.discount")}
                      </label>

                      <input
                        type="number"
                        min={0}
                        value={form.discount}
                        onChange={
                          e=>
                          setForm({
                            ...form,
                            discount:
                              e.target.value
                          })
                        }
                      />

                    </div>


                    <div className="invoice-summary-cell">

                      <label>
                        {t("common.tax")}
                      </label>

                      <input
                        type="number"
                        min={0}
                        value={form.tax}
                        onChange={
                          e=>
                          setForm({
                            ...form,
                            tax:
                              e.target.value
                          })
                        }
                      />

                    </div>


                    <div className="invoice-summary-cell">

                      <label>
                        {tf(
                          "invoices.grandTotal",
                          "Grand Total"
                        )}
                      </label>

                      <div className="invoice-summary-infobox grand">
                        {formatFullAmount(total)}
                      </div>

                    </div>


                    <div className="invoice-summary-cell">

                      <label>
                        {t("common.paid")}
                      </label>

                      <input
                        type="number"
                        min={0}
                        value={form.paid}
                        onChange={
                          e=>
                          setForm({
                            ...form,
                            paid:
                              e.target.value
                          })
                        }
                      />

                    </div>


                    <div className="invoice-summary-cell">

                      <label>
                        {t("common.due")}
                      </label>

                      <div className="invoice-summary-infobox due">
                        {formatFullPlainAmount(due)}
                      </div>

                    </div>


                  </div>


                </div>


              </div>







              <textarea

                placeholder={
                  t("invoices.notesPlaceholder")
                }

                value={form.notes}

                onChange={
                  e=>

                  setForm({

                    ...form,

                    notes:
                      e.target.value

                  })

                }

              />







              {formError && (

                <p className="form-error" role="alert">{formError}</p>

              )}


              <button

                className="save-invoice"

                onClick={saveInvoice}

                disabled={isSubmitting}

              >

                {isSubmitting ? tf("common.saving","Saving...") : t("invoices.saveInvoice")}


              </button>





            </div>


          </div>


        )

      }







      {
        viewInvoice && (


          <div className="modal-overlay">


            <div className="invoice-view-modal">



              <div className="modal-header">


                <h2>

                  {viewInvoice.invoice_id}

                </h2>




                <button

                  onClick={
                    ()=>setViewInvoice(null)
                  }

                >

                  <X size={20}/>


                </button>



              </div>






              <div className="invoice-view-body">



                <div className="invoice-view-row">

                  <span>

                    {t("common.customer")}

                  </span>


                  <strong>

                    {viewInvoice.customer_name}

                  </strong>


                </div>






                <div className="invoice-view-row">

                  <span>

                    {t("common.date")}

                  </span>


                  <strong>

                    {formatDateShort(
                      viewInvoice.invoice_date
                    )}

                  </strong>


                </div>







                <table className="invoice-view-table">


                  <thead>

                    <tr>

                      <th>

                        {t("common.item")}

                      </th>


                      <th>

                        {t("common.quantity")}

                      </th>


                      <th>

                        {t("common.price")}

                      </th>


                      <th>

                        {t("common.total")}

                      </th>


                    </tr>


                  </thead>





                  <tbody>


                    {
                      (viewInvoice.items || [])
                      .map((item,i)=>(


                        <tr key={i}>


                          <td>

                            {item.product_name}

                          </td>


                          <td>

                            {item.quantity}

                          </td>


                          <td>

                            {formatAmount(item.price)}

                          </td>


                          <td>

                            {formatAmount(item.total)}

                          </td>



                        </tr>


                      ))

                    }



                  </tbody>



                </table>







                <div className="invoice-view-row grand">


                  <span>

                    {t("common.total")}

                  </span>


                  <strong>

                    {formatAmount(
                      viewInvoice.total
                    )}

                  </strong>


                </div>






                <div className="invoice-view-row">


                  <span>

                    {t("common.paid")}

                  </span>


                  <strong>

                    {formatAmount(
                      viewInvoice.paid
                    )}

                  </strong>


                </div>






                <div className="invoice-view-row">


                  <span>

                    {t("common.due")}

                  </span>


                  <strong>

                    {formatAmount(
                      viewInvoice.due
                    )}

                  </strong>


                </div>




              </div>







              <div className="invoice-view-actions">


                <button

                  onClick={
                    ()=>printInvoice(viewInvoice)
                  }

                >

                  <Printer size={16}/>

                  {t("common.print")}


                </button>





                <button

                  onClick={
                    ()=>exportPdf(viewInvoice)
                  }

                >

                  <FileDown size={16}/>

                  {t("common.exportPdf")}


                </button>




              </div>





            </div>


          </div>


        )

      }




    </div>


  );


}		  