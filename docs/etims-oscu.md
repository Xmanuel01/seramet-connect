# KRA eTIMS (OSCU) in Seramet

Seramet signs each receipt with KRA through an Online Sales Control Unit (OSCU)
before the receipt prints, as KRA's TIS specification requires. It follows:

- OSCU Specification Document v2.0 - https://www.kra.go.ke/images/publications/OSCU_Specification_Document_v2.0.pdf
- TIS for OSCU/VSCU Technical Specifications v2.0 - https://www.kra.go.ke/images/publications/TIS-for-OSCU--VSCU-Technical-Specifications-v2.0.pdf

It is off until a branch is set up and activated. Nothing prints eTIMS details
except KRA's own signed response.

## 1. Get KRA sandbox access (one time)

Follow KRA's "OSCU/VSCU step-by-step guide on how to sign up":
https://www.kra.go.ke/images/publications/OSCU_VSCU_Step-by-Step_Guide-on-how-to-sign-up.pdf

1. Sign up on the eTIMS sandbox portal (https://etims-sbx.kra.go.ke) with the business PIN.
2. Raise a service request for **OSCU**, naming Seramet as the invoicing system.
3. KRA approves it and gives the **branch ID** (bhfId, usually `00` for the head office)
   and the **device serial number**.
4. Look up the KRA **item classification code** that fits the menu (KRA's code list).

## 2. Set up the branch in Seramet

Setup centre -> Tax & service -> **KRA eTIMS (OSCU)**:

1. KRA server: Sandbox. Enter PIN, branch ID, device serial and item classification code.
2. Choose how items with no VAT rule are reported: D Non-VAT (default), A Exempt or C Zero-rated.
3. **Save details**, then **Activate with KRA**. KRA returns the communication key (cmcKey),
   which Seramet keeps in the encrypted secret store; the database holds only its reference.
4. **Turn eTIMS on.** From then on every receipt printed for the branch is signed first.
   Sandbox receipts print "eTIMS SANDBOX - NOT A VALID TAX RECEIPT".

KRA activates a device once. If activation answers "Device already installed", the key from
the first activation is needed; ask KRA to reset the device.

## 3. What happens when a receipt prints

1. Each item is registered with KRA (`/saveItem`) the first time it is sold, with an item code
   such as `KE2NTU0000001`. Items take their tax type from their VAT rule: 16% is B, 8% is E.
   Service and delivery charges are service items at the branch's single VAT rate.
2. The sale is sent (`/saveTrnsSalesOsdc`) with the branch's next invoice number. Amounts are
   VAT-inclusive, as eTIMS expects. A sale whose items do not add up to the receipt's recorded
   total is not sent.
3. KRA's answer (receipt numbers, internal data, signature, SCU date and time) is stored. The
   receipt prints the supplier PIN, the tax table, the eTIMS QR and the SCU information block.
4. If KRA does not answer, the receipt does not print and the cashier sees KRA's message; a
   retry reuses the same invoice number. Reprints use the stored signature; nothing is sent
   again.

## 4. Before going live (production)

- Complete KRA's certification of the integration in the sandbox.
- Confirm with KRA during certification:
  - the receipt QR content: the KRA verification link (default) or the TIS 6.23.8 data string;
    both are selectable in settings;
  - VAT treatment of service and delivery charges;
  - reprint handling (Seramet prints the stored signature under DUPLICATE COPY; KRA's copy
    receipt type C is not sent).
- Then switch the KRA server to Production and activate the production device.

Credit notes, purchases, stock movements and imports are not sent to eTIMS yet.
