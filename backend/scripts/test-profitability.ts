async function testProfitability() {
    try {
        const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'admin@codadmin.com',
                password: 'password123'
            })
        });

        const loginData = await loginResponse.json() as any;
        const token = loginData.tokens?.accessToken;

        if (!token) {
            console.error('❌ Login failed:', JSON.stringify(loginData, null, 2));
            return;
        }

        console.log('✅ Logged in successfully');

        const profitabilityResponse = await fetch('http://localhost:3000/api/financial/profitability', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const profitabilityData = await profitabilityResponse.json() as any;

        if (profitabilityResponse.status !== 200) {
            console.error('❌ Error fetching profitability:', JSON.stringify(profitabilityData, null, 2));
            return;
        }

        console.log('📈 Profitability Analysis Summary:');
        console.log(JSON.stringify(profitabilityData.summary, null, 2));

        console.log('\n📦 Product Profitability (Top 3):');
        console.log(JSON.stringify(profitabilityData.products.slice(0, 3), null, 2));

        console.log('\n📅 Daily Profitability (First 3):');
        console.log(JSON.stringify(profitabilityData.daily.slice(0, 3), null, 2));

    } catch (error: any) {
        console.error('❌ Error testing profitability:', error.message);
    }
}

testProfitability();
