# WilcoHRBenefitEstimator

Open `index.html` in a browser to use the estimator. The shared county stylesheet,
logo, and chart libraries require an internet connection.

Run the calculation and validation regression checks with Node.js:

```sh
node --test benefits.test.cjs
```

Annual medical plan amounts are maintained in `medicalPlans` at the top of
`benefits.js`. The current table contains the existing 2026 rates.
