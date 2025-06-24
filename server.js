require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(bodyParser.json());

const REVENUECAT_API = 'https://api.revenuecat.com/v2';
const STRIPE_PRICE_ID = process.env.SUBSCRIPTION_PRICE_ID;

// Receive BigCommerce order.created webhook
app.post('/webhook/bigcommerce', async (req, res) => {
  try {
    const orderId = req.body.data.id;

    // 🔐 Auth headers for BigCommerce API
    const bcHeaders = {
      'X-Auth-Token': process.env.BC_ACCESS_TOKEN,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // 🔄 Fetch full order details
    const orderRes = await axios.get(
      `https://api.bigcommerce.com/stores/${process.env.BC_STORE_HASH}/v2/orders/${orderId}`,
      { headers: bcHeaders }
    );

    const order = orderRes.data;
    const customerEmail = order.billing_address.email;
    const customerId = order.customer_id;
    console.log(order);

    // ✅ Check for subscription product
    const productsRes = await axios.get(
      `https://api.bigcommerce.com/stores/${process.env.BC_STORE_HASH}/v2/orders/${orderId}/products`,
      { headers: bcHeaders }
    );
    console.log(productsRes);

    const products = productsRes.data;

    const isSubscription = products.some(p =>
      (p.product_options || []).some(opt =>
        opt.display_name.toLowerCase() === 'purchase type' &&
        opt.display_value.toLowerCase() === 'subscription - monthly'
      )
    );

    if (!isSubscription) {
      return res.status(200).send('No subscription detected');
    }

    console.log(orderId)
  const txnsRes = await axios.get(
    `https://api.bigcommerce.com/stores/${process.env.BC_STORE_HASH}/v3/orders/${orderId}/transactions`,
    { headers: bcHeaders }
  );

  const transactions = txnsRes.data.data;
  const transactionId = transactions?.[0]?.gateway_transaction_id;

  const intent = await stripe.paymentIntents.retrieve(transactionId);
  const paymentMethodID = intent.payment_method;
  
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodID);
    let customerIdToUse;
    if (!paymentMethod.customer){
      const stripeCustomer = await stripe.customers.create({
        email: customerEmail,
        metadata: { bigcommerce_customer_id: customerId }
      });

      await stripe.paymentMethods.attach(paymentMethodID, {
        customer: stripeCustomer.id
      })
      customerIdToUse = stripeCustomer.id;
    }
    else{
      customerIdToUse = paymentMethod.customer;
    }
    console.log(customerIdToUse);

    await stripe.subscriptions.create({
      customer: customerIdToUse,
      default_payment_method: paymentMethodID,
      items: [{ price: STRIPE_PRICE_ID }],
      metadata: { bigcommerce_customer_id: customerId }
    });

    // await axios.post(`${REVENUECAT_API}/subscribers/${customerId}`, {
    //   attributes: { email: customerEmail }
    // }, {
    //   headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` }
    // });

    console.log(`Subscription created for ${customerEmail}`);
    res.status(200).send('Subscription created');

  } catch (err) {
    console.error('Error processing BigCommerce webhook:', err);
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

