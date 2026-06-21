import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_EMAIL = 'sardar@maras.iq';
const ADMIN_PASSWORD = 'Maras@2024!';

const TEST_CLIENT_EMAIL = 'testclient@etir.com';
const TEST_CLIENT_PASSWORD = '123456';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Use service-role client for DB operations
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Step 1: Check if admin user already exists and is confirmed
    const { data: existingUsers } = await adminClient
      .from('user_profiles')
      .select('id, email')
      .eq('email', ADMIN_EMAIL)
      .limit(1);

    if (existingUsers && existingUsers.length > 0) {
      // User profile exists — ensure email is confirmed and reset password
      await adminClient.rpc('confirm_admin_email', { admin_email: ADMIN_EMAIL });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
      // Always sync the password via admin API to ensure it matches
      const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers();
      const adminUser = allUsers?.find((u: any) => u.email === ADMIN_EMAIL);
      if (adminUser) {
        await adminClient.auth.admin.updateUserById(adminUser.id, { password: ADMIN_PASSWORD });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
      }
      // Also ensure test client exists
      await ensureTestClient(adminClient);
      return new Response(JSON.stringify({ success: true, status: 'already_exists', passwordReset: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
    }

    // Step 2: Sign up using anon client (normal registration)
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      options: { data: { full_name: 'Sardar (MARAS Admin)' } },
    });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}

    if (signUpError) {
      // If user already registered in auth but not in user_profiles
      if (signUpError.message.toLowerCase().includes('already')) {
        // Try to confirm via SQL function
        await adminClient.rpc('confirm_admin_email', { admin_email: ADMIN_EMAIL });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
        return new Response(JSON.stringify({ success: true, status: 'confirmed_existing' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
      }
      return new Response(JSON.stringify({ error: signUpError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
    }

    const userId = signUpData.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Signup returned no user ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
    }

    // Step 3: Immediately confirm email via SQL function (SECURITY DEFINER bypasses RLS)
    const { error: confirmError } = await adminClient.rpc('confirm_admin_email', { admin_email: ADMIN_EMAIL });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}

    // Step 4: Create test customer account
    await ensureTestClient(adminClient);

    return new Response(JSON.stringify({
      success: true,
      status: 'created',
      userId,
      emailConfirmed: !confirmError,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
  }
});

async function ensureTestClient(adminClient: any) {
  try {
    // Check if test client auth user already exists
    const { data: { users } } = await adminClient.auth.admin.listUsers();
    let testUser = users?.find((u: any) => u.email === TEST_CLIENT_EMAIL);

    if (!testUser) {
      // Create auth user with confirmed email
      const { data, error } = await adminClient.auth.admin.createUser({
        email: TEST_CLIENT_EMAIL,
        password: TEST_CLIENT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test Client' },
      });
      if (error) { console.log('Test client create error:', error.message); return; }
      testUser = data.user;
    } else {
      // Ensure password is reset to test value
      await adminClient.auth.admin.updateUserById(testUser.id, { password: TEST_CLIENT_PASSWORD });
    }

    if (!testUser?.id) return;

    // Check if a client record is linked to this test user
    const { data: linkedClient } = await adminClient
      .from('clients')
      .select('id')
      .eq('customer_user_id', testUser.id)
      .maybeSingle();

    if (!linkedClient) {
      // Create a demo client record and link it
      // Check if a client record with this email already exists; if so, just link it
      const { data: emailClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('email', TEST_CLIENT_EMAIL)
        .maybeSingle();

      if (emailClient) {
        await adminClient.from('clients').update({ customer_user_id: testUser.id }).eq('id', emailClient.id);
      } else {
        const { error: insertErr } = await adminClient.from('clients').insert({
          name: 'Test Client',
          company: 'Demo Company',
          email: TEST_CLIENT_EMAIL,
          phone: '+964 770 000 0001',
          country: 'Iraq',
          city: 'Baghdad',
          notes: 'Auto-created test account for customer portal demo.',
          customer_user_id: testUser.id,
        });
        if (insertErr) console.log('Test client record error:', insertErr.message);
      }
    }
  } catch (e) {
    console.log('ensureTestClient error:', String(e));
  }
}
