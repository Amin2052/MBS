// report-service.ts
// Generated replacement scaffold

import { getInvoices, getInvoiceSummary } from "../repositories/invoice-repository";
import { getTransactionSummary, getTransactionsByDate } from "../repositories/accounting-repository";
import { getInventoryTransactions } from "../repositories/inventory-repository";
import { getProducts } from "../repositories/product-repository";

export interface ReportSummary {
  totalInvoices:number;
  totalSales:number;
  totalPaid:number;
  totalDue:number;
  totalIncome:number;
  totalExpense:number;
  balance:number;
  netProfit:number;
  totalProducts:number;
  totalStock:number;
  stockValue:number;
  averageInvoice:number;
  paidInvoices:number;
  unpaidInvoices:number;
  partialInvoices:number;
  overdueInvoices:number;
}

export function generateReport(): ReportSummary {
  const invoiceSummary = getInvoiceSummary() as any;
  const accountingSummary = getTransactionSummary() as any;
  const products = getProducts();
  const inventory = getInventoryTransactions();

  let totalStock = 0;
  if (Array.isArray(inventory)) {
    for (const item of inventory) {
      if (item.type === "IN") totalStock += Number(item.quantity ?? 0);
      else if (item.type === "OUT") totalStock -= Number(item.quantity ?? 0);
    }
  }

  let stockValue = 0;
  if (Array.isArray(products)) {
    for (const p of products) {
      stockValue += Number((p as any).stock ?? 0) * Number((p as any).price ?? 0);
    }
  }

  const totalInvoices = Number(invoiceSummary?.totalInvoices ?? 0);
  const totalSales = Number(invoiceSummary?.totalAmount ?? 0);
  const totalIncome = Number(accountingSummary?.totalIncome ?? 0);
  const totalExpense = Number(accountingSummary?.totalExpense ?? 0);

  return {
    totalInvoices,
    totalSales,
    totalPaid:Number(invoiceSummary?.totalPaid ?? 0),
    totalDue:Number(invoiceSummary?.totalDue ?? 0),
    totalIncome,
    totalExpense,
    balance:Number(accountingSummary?.balance ?? 0),
    netProfit: totalIncome-totalExpense,
    totalProducts: Array.isArray(products)?products.length:0,
    totalStock,
    stockValue,
    averageInvoice: totalInvoices? totalSales/totalInvoices:0,
    paidInvoices:Number(invoiceSummary?.paidCount ?? 0),
    unpaidInvoices:Number(invoiceSummary?.unpaidCount ?? 0),
    partialInvoices:Number(invoiceSummary?.partialCount ?? 0),
    overdueInvoices:Number(invoiceSummary?.overdueCount ?? 0),
  };
}

export function generateDateReport(fromDate?:string,toDate?:string){
  return {
    invoices:getInvoices({fromDate,toDate}),
    transactions:getTransactionsByDate(fromDate,toDate),
    inventory:getInventoryTransactions(fromDate,toDate)
  };
}
