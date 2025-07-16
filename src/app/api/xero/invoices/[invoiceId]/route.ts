import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrCreateXeroContact } from '@/lib/xero/contacts';
import { getActiveTenant, getAuthenticatedXeroClient } from '@/lib/xero/client';

export async function GET(
  request: NextRequest,
  { params }: { params: { invoiceId: string } }
) {
  try {
    const supabase = await createClient();
    
    // Get user from session
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get active tenant
    const activeTenant = await getActiveTenant();
    if (!activeTenant) {
      return NextResponse.json({ error: 'No active Xero tenant' }, { status: 400 });
    }

    // Get authenticated Xero client
    const xeroClient = await getAuthenticatedXeroClient(activeTenant.tenant_id);
    if (!xeroClient) {
      return NextResponse.json({ error: 'Xero not connected' }, { status: 400 });
    }

    // Fetch the specific invoice from Xero
    const response = await xeroClient.accountingApi.getInvoice(activeTenant.tenant_id, params.invoiceId);
    
    if (!response.body.invoices || response.body.invoices.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoice = response.body.invoices[0];

    // Verify this invoice belongs to the current user
    const userContactResult = await getOrCreateXeroContact(user.id, activeTenant.tenant_id);
    if (!userContactResult.success || !userContactResult.xeroContactId) {
      return NextResponse.json({ error: 'Unable to verify user contact' }, { status: 500 });
    }
    
    if (invoice.contact?.contactID !== userContactResult.xeroContactId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Format the invoice for the frontend
    const formattedInvoice = {
      id: invoice.invoiceID,
      number: invoice.invoiceNumber,
      status: invoice.status,
      date: invoice.date,
      dueDate: invoice.dueDate,
      amount: invoice.total,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      currency: invoice.currencyCode,
      contact: {
        name: invoice.contact?.name,
        email: invoice.contact?.emailAddress
      },
      lineItems: invoice.lineItems?.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        lineAmount: item.lineAmount,
        accountCode: item.accountCode
      })) || [],
      payments: invoice.payments?.map(payment => ({
        paymentID: payment.paymentID,
        date: payment.date,
        amount: payment.amount,
        reference: payment.reference
      })) || []
    };

    return NextResponse.json(formattedInvoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoice' },
      { status: 500 }
    );
  }
} 