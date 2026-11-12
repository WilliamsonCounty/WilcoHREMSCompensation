# WilcoHRBenefitEstimator

Open `index.html` in a browser to use the estimator. The shared county stylesheet,
logo, and chart libraries require an internet connection.

Run the calculation and validation regression checks with Node.js:

```sh
node --test benefits.test.cjs
```

Annual medical plan amounts are maintained in `medicalPlans` at the top of
`benefits.js`. The current table contains the existing 2026 rates.

EMS salary conversions use a 56-hour work week across 52 weeks: 40 hours at the
regular rate plus 16 hours at time-and-a-half. Annual pay is hourly pay multiplied
by 3,328; hourly pay is annual pay divided by 3,328. This includes scheduled
overtime but excludes pay for additional shifts and stipends. Displayed hourly
rates are rounded to cents, so estimates may differ slightly from the pay chart.
Retirement and the
salary portion of the chart use the resulting annual pay. Leave accrual hours
are maintained separately and are not scaled by the work week.

The pay-increase preview offers 0–10% in half-percentage-point increments.
Both preview rates update immediately from the original salary, without
compounding when the selection changes. Calculate applies the selected increase
to salary, retirement, and total compensation; medical plan amounts stay fixed.
