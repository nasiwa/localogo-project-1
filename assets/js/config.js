const SUPABASE_URL = 'https://qbkhapuewbclazyykslr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia2hhcHVld2JjbGF6eXlrc2xyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzcxOTAsImV4cCI6MjA4ODM1MzE5MH0.Io6iH9zJ87aCpy3FhNynsAvxTAfnMCJtzMJDNE8L3Jw';

// Dynamic Backend URL for Local vs Production
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : window.location.origin;

const MIDTRANS_CLIENT = 'SB-Mid-client-867f05f8846726194273'; // Sandbox Client Key
