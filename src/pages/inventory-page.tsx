import { useEffect, useMemo, useState } from "react";

import { Search } from "lucide-react";

import "./inventory.css";

import { formatNumber } from "../utils/format-number";
import { useCurrency } from "@/hooks/use-currency";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "@/components/toast/toast-store";

// Product and InventoryTransaction are declared globally in
// src/types/electron.d.ts (previously this file redeclared local
// copies of both types).


export default function InventoryPage(){

  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();



  const [products,setProducts] =
    useState<Product[]>([]);



  const [transactions,setTransactions] =
    useState<InventoryTransaction[]>([]);




  const [loading,setLoading] =
    useState(false);




  const [search,setSearch] =
    useState("");




  const [selectedProduct,setSelectedProduct] =
    useState("");




  const [quantity,setQuantity] =
    useState<number | "">(1);




  const [note,setNote] =
    useState("");


  const [isSubmitting,setIsSubmitting] =
    useState(false);







  async function loadData(){


    try{


      setLoading(true);



      const productData =
        await window.mooral.products.getAll();




      const transactionData =
        await window.mooral.inventory.getAll();





      setProducts(productData);



      setTransactions(transactionData);






      if(

        productData.length &&

        !selectedProduct

      ){


        setSelectedProduct(

          productData[0].product_id

        );


      }




    }

    catch(error){


      console.error(

        "Inventory loading failed",

        error

      );


    }


    finally{


      setLoading(false);


    }


  }







  useEffect(()=>{


    loadData();


  },[]);







  const filteredTransactions = useMemo(()=>{


    return transactions.filter(item=>{



      const product =

        products.find(

          p =>

          p.product_id === item.product_id

        );




      const productName =

        product?.name ??

        item.product_id;





      return (


        productName

          .toLowerCase()

          .includes(

            search.toLowerCase()

          )


        ||


        item.type

          .toLowerCase()

          .includes(

            search.toLowerCase()

          )


        ||


        item.product_id

          .toLowerCase()

          .includes(

            search.toLowerCase()

          )


      );



    });



  },[

    transactions,

    products,

    search

  ]);





  async function handleStockIn(){


    if(!selectedProduct)

      return;


    if(quantity === "" || Number(quantity) <= 0){

      toast.warning(t("inventory.invalidQuantity"));

      return;

    }


    // Prevent a fast double-click (or a slow IPC round trip) from firing
    // the same stock movement twice, which would double-count it in
    // both products.stock and the inventory_transactions ledger.
    if(isSubmitting)

      return;


    setIsSubmitting(true);


    try{

      await window.mooral.inventory.stockIn({
        product_id:selectedProduct,
        quantity,
        note
      });

    }
    catch(error){

      console.error("Failed to record stock in:", error);

      toast.error(t("inventory.stockInFailed"));

      return;

    }

    finally{

      setIsSubmitting(false);

    }




    setQuantity(1);



    setNote("");



    loadData();



  }





  async function handleStockOut(){


    if(!selectedProduct)

      return;


    if(quantity === "" || Number(quantity) <= 0){

      toast.warning(t("inventory.invalidQuantity"));

      return;

    }


    if(isSubmitting)

      return;


    setIsSubmitting(true);


    try{

      await window.mooral.inventory.stockOut({
        product_id:selectedProduct,
        quantity,
        note
      });

    }
    catch(error){

      console.error("Failed to record stock out:", error);

      toast.error(t("inventory.stockOutFailed"));

      return;

    }

    finally{

      setIsSubmitting(false);

    }




    setQuantity(1);



    setNote("");



    loadData();



  }
  




  const totalProducts = useMemo(
    () => products.length,
    [products]
  );


  const totalStock = useMemo(
    () => products.reduce(
      (sum,p)=> sum + Number(p.stock || 0),
      0
    ),
    [products]
  );


  const stockValue = useMemo(
    () => products.reduce(
      (sum,p)=> sum + (Number(p.stock || 0) * Number(p.price || 0)),
      0
    ),
    [products]
  );


  const lowStock = useMemo(
    () => products.filter(p => Number(p.stock) <= 5).length,
    [products]
  );












  return (


    <div className="inventory-page">





      <div className="inventory-header">


        <div>


          <h1>

            {t("inventory.title")}

          </h1>



          <p>

            {t("inventory.subtitle")}

          </p>


        </div>





        <button

          className="refresh-btn"

          onClick={loadData}

        >


          Refresh


        </button>




      </div>









      <div className="inventory-summary">





        <div className="summary-card">


          <h3>

            {t("inventory.totalProducts")}

          </h3>



          <strong>

            {formatNumber(totalProducts)}

          </strong>


        </div>









        <div className="summary-card">


          <h3>

            {t("inventory.totalStock")}

          </h3>



          <strong>

            {formatNumber(totalStock)}

          </strong>


        </div>









        <div className="summary-card">


          <h3>

            {t("inventory.stockValue")}

          </h3>



          <strong>


            {formatCurrency(stockValue)}


          </strong>


        </div>









        <div className="summary-card">


          <h3>

            {t("inventory.lowStock")}

          </h3>



          <strong>


            {formatNumber(lowStock)}


          </strong>


        </div>





      </div>














      <div className="inventory-action-card">





        <h2>

          {t("inventory.stockAdjustment")}

        </h2>







        <div className="inventory-field-group">

          <label>
            {t("inventory.product")}
          </label>

          <select

            value={selectedProduct}

            onChange={

              e =>
              setSelectedProduct(
                e.target.value
              )

            }

          >

            {

              products.map(product=>(

                <option

                  key={product.id}

                  value={product.product_id}

                >

                  {product.name}

                </option>

              ))

            }

          </select>

        </div>



        <div className="inventory-field-group">

          <label>
            {t("inventory.quantity")}
          </label>

          <input

            type="number"

            value={quantity}

            min="1"

            onChange={

              e =>
              setQuantity(
                e.target.value === "" ? "" : Number(e.target.value)
              )

            }

          />

        </div>



        <div className="inventory-field-group">

          <label>
            {t("inventory.note")}
          </label>

          <input

            placeholder={t("inventory.note")}

            value={note}

            onChange={

              e =>
              setNote(
                e.target.value
              )

            }

          />

        </div>



        <div className="inventory-buttons">





          <button


            className="stock-in-btn"


            onClick={handleStockIn}

            disabled={isSubmitting}


          >


            {isSubmitting ? t("inventory.saving") : t("inventory.stockIn")}


          </button>








          <button


            className="stock-out-btn"


            onClick={handleStockOut}

            disabled={isSubmitting}


          >


            {isSubmitting ? t("inventory.saving") : t("inventory.stockOut")}


          </button>





        </div>




      </div>
	  





      <div className="inventory-card">





        <div className="inventory-card-header">


          <h2>

            {t("inventory.stockHistory")}

          </h2>





          <div className="search-box">

            <Search size={18}/>

            <input


              placeholder={t("inventory.searchPlaceholder")}


              value={search}


              onChange={


                e =>

                setSearch(

                  e.target.value

                )


              }


            />

          </div>



        </div>









        <div className="inventory-table">





          <div className="inventory-table-head">



            <span>

              {t("inventory.product")}

            </span>



            <span>

              {t("inventory.type")}

            </span>



            <span>

              {t("inventory.quantity")}

            </span>



            <span>

              {t("inventory.date")}

            </span>



          </div>









          <div className="inventory-table-body">





          {


            loading ?



            (

              <div className="inventory-empty-state">


                {t("inventory.loading")}


              </div>


            )



            :



            filteredTransactions.length === 0 ?



            (

              <div className="inventory-empty-state">


                {t("inventory.noHistoryFound")}


              </div>


            )



            :



            filteredTransactions.map(item=>{





              const product =


                products.find(


                  p =>

                  p.product_id === item.product_id


                );







              return (





                <div


                  className="inventory-row"


                  key={item.id}


                >






                  <span>


                    {


                      product?.name ??

                      item.product_id


                    }


                  </span>










                  <span


                    className={


                      item.type === "IN"

                      ?

                      "stock-in-text"

                      :

                      "stock-out-text"


                    }



                  >


                    {item.type}



                  </span>









                  <span>


                    {formatNumber(item.quantity)}


                  </span>









                  <span>



                    {


                      item.created_at
                      ?
                      new Date(
                        item.created_at
                      )
                      .toLocaleDateString()
                      :
                      "—"



                    }



                  </span>








                </div>





              );





            })





          }





          </div>






        </div>







      </div>









    </div>



  );


}