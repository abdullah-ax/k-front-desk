# Front Desk, in five minutes

Read this once before you demo. Every number here is real and comes from the
running system.

---

## What problem this solves

Gulf Breeze Air is an air-conditioning company in Miami. 17 technicians in the
field, 1,992 jobs on the books, 1,327 buildings they service.

All day, the phone rings. It is a customer who wants to know when someone is
coming, or wants to move an appointment, or is standing next to a unit that
stopped working. Right now a person has to answer every one of those calls,
find the right building in the system, and read the answer back.

This software does that job.

## What it actually is

Two halves that share one brain.

**The phone agent.** It answers the phone, works out which building the caller
is at, looks up the real record, and answers from it. It can move an
appointment, book one, add a note, or flag a job as running late. It hands the
call to a human when it should.

**The office screen.** Where a dispatcher sees today's work, the calls coming
in, and everything the agent did — with a button to undo any of it.

Both halves write to the *same* record, through the *same* code. The agent has
no special access and no shortcut. Anything it does, a person could have done by
hand, and can take back.

## Who the customer is

**A building is the customer, not a person.**

Most systems file everything under a person's name. That breaks constantly:
people move, companies change managers, two people share a house, a property
manager looks after forty units. But the air conditioner never moves. So
everything here hangs off the address.

The agent's first move on every call is to pin down *which building*. It will
not tell you anything before that.

## The three promises

These are what separate a demo from something you would actually plug in.

**1. It reads the change back before it makes it.**
The agent never moves an appointment in the same breath it suggests one. It
says the address, the day and the time, and waits for a yes. That gap is the
only moment a caller can hear a wrong address and stop it. A misheard house
number lands on a different real building about 70% of the time.

**2. Anything the agent did, you can undo in one click.**
Not "file a ticket to reverse it." A button, on the screen, next to the change.
Undo adds a correction rather than erasing history, so the record still shows
what happened.

**3. The call log shows the work behind every answer.**
Most call logs are a transcript. This one shows, in order: what was said, why
the agent decided what it decided, which lookup it ran, and the exact question
it asked the database. Then how many rows came back, how long it took, and what
changed in the book. Nothing is taken on trust.

## What it will not do, on purpose

It will not read out a door code, ever, however the caller asks. It will not
quote a price for a new system. It will not tell you whether something is under
warranty — it will show you the paperwork and let a person decide.

Those limits are the answer to "what happens when this thing is wrong." It
refuses, says why, and hands the call over.

When someone says the word *gas*, the call goes to a person straight away,
whether or not the agent thinks it needs to.

## The numbers

| | |
|---|---|
| Jobs on the books | 1,992 |
| Buildings | 1,327 |
| Technicians | 17 |
| Finished jobs never invoiced | **150** |
| Invoices written and never sent | **38, worth $55,207** |
| Jobs booked with nobody assigned | 47 |
| Times it picked the wrong building | **0** |
| Safety and refusal tests passed | **19 of 19** |

The first two of those are work already done that nobody billed for. The third
is work already promised that nobody has been sent to do. The software found all
three by asking the database a question in plain English.

## What to say if someone asks

**"Is this just a chatbot on top of a database?"**
No. A chatbot answers. This one *changes the record*, and every change carries
the call that caused it, the reason, and a way back.

**"What if it gets something wrong?"**
Then a person catches it on the screen and clicks undo. The undo exists for
exactly that, and the log shows the lookup it ran as well as the words it said.
The design assumes it will be wrong sometimes.

**"Why is it so plain-looking?"**
Because a dispatcher looks at this screen for eight hours while a phone is
ringing. Colour means something specific here — orange means a human needs to
act. If everything were coloured, nothing would be.

**"Could it take a real call today?"**
It does. There is a live phone number and it answers.
