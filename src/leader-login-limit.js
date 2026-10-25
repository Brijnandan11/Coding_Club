import {rateLimit} from 'express-rate-limit';
import {createHash} from 'node:crypto';

// Campus Wi-Fi and reverse proxies can make many leaders share one IP.
// Count failed attempts per leader code; successful sign-ins spend no allowance.
export function createLeaderLoginLimit(){return rateLimit({
 windowMs:15*60_000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,
 keyGenerator:req=>createHash('sha256').update(req.body.leader_id.toUpperCase()).digest('hex'),
 skipSuccessfulRequests:true,
 message:{error:'Too many failed sign-in attempts for this leader code. Wait 15 minutes before trying again.'},
});}
