import { ComparisonDataset } from '../types';

export const SAMPLE_DATASETS: ComparisonDataset[] = [
  {
    id: 'cerc-dsm-2024',
    name: 'CERC Deviation Settlement Mechanism (DSM)',
    description: 'Central Electricity Regulatory Commission (Deviation Settlement Mechanism and Related Matters) Regulations with stakeholder comments from power generators and traders.',
    draftDoc: {
      id: 'draft-cerc-dsm',
      title: 'Draft CERC Deviation Settlement Regulations',
      fileName: 'draft.pdf',
      paragraphs: [
        'Regulation 5. Charges for Deviations: (1) The charges for deviation in a time block for a general grid user shall be as specified in Annexure-I of these regulations.',
        'Clause K(ii): "In case of merchant generators, reference charge rate shall be the contract rate or the Area Clearing Price (ACP) of the Day Ahead Market of the Power Exchange." Note that this clause does not account for generators selling through multiple power exchanges or using composite weighted pricing across segments.',
        'Clause K(iv): "Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes."',
        'Clause 8. Allocation of Deviation Charges for Multiple Transactions: Where a seller or buyer has multiple open access transactions in a single time block, deviation settlement shall be computed against the scheduled energy of each contract separately, without inter-state or intra-state pooling.',
        'Clause 10. Frequency Linked Deviations: Charges for deviation shall be zero for over-injection up to 10% in case of run of the river hydro plants and renewable generating stations.',
        'Clause 14. Real-time Monitoring: Grid operators shall publish quarterly reports of deviation settlement charges collected across all regional pools.'
      ],
      fullText: `Draft Central Electricity Regulatory Commission (Deviation Settlement Mechanism and Related Matters) Regulations.
1. Short Title and Commencement.
2. Definitions and Interpretations.
3. Scope and Applicability.
4. Objective: To maintain grid security and stability through financial discipline.
5. Charges for Deviations:
(1) The charges for deviation in a time block for a general grid user shall be as specified in Annexure-I of these regulations.
(2) Clause K(ii): "In case of merchant generators, reference charge rate shall be the contract rate or the Area Clearing Price (ACP) of the Day Ahead Market of the Power Exchange."
(3) Clause K(iv): "Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes."
(4) Clause 8: Allocation of Deviation Charges for Multiple Transactions: Where a seller or buyer has multiple open access transactions in a single time block, deviation settlement shall be computed against the scheduled energy of each contract separately, without inter-state or intra-state pooling.
(5) Clause 10: Charges for deviation shall be zero for over-injection up to 10% in case of run of the river hydro plants and renewable generating stations.
(6) Clause 14: Grid operators shall publish quarterly reports of deviation settlement charges collected across all regional pools.`
    },
    finalDoc: {
      id: 'final-cerc-dsm',
      title: 'Final Gazette Notification — CERC DSM Regulations',
      fileName: 'final.pdf',
      paragraphs: [
        'Regulation 5. Charges for Deviations: (1) Charges for deviations for all grid connected entities shall be computed in accordance with the methodology in Annexure-I and Annexure-II of these regulations.',
        'Annexure-I, Clause (iii): "in respect of a WS seller or a MSW seller or such other entity as applicable, selling power through open access to a third party or in case of captive consumption of a captive generating plant based on renewable energy sources, the weighted average ACP of the Integrated-Day Ahead Market segments of all Power Exchanges for the respective time block;"',
        'Annexure-I, Clause (iv): "in case of multiple contracts or transactions including captive consumption, the weighted average of the reference rates of all such contracts or transactions; (iv) in case of multiple contracts or transactions including captive consumption, the weighted average of the contract rates of all such contracts or transactions, as the case may be;"',
        'Regulation 7. Definition of Reference Charge Rate and Contract Rate: Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes. The Commission affirms the established legal definition without alteration.',
        'Regulation 12. Settlement for Entities with Single Meter Multi-Contract: The deviation settlement for entities scheduling power under multiple contracts across inter-state and intra-state segments through a single metering point shall be apportioned on the basis of weighted average contract rates.',
        'Regulation 15. Frequency-dependent Charges: The charges for deviation when frequency deviates below 49.90 Hz or above 50.05 Hz shall be levied based on the graded system in Schedule A. The standard penalty matrix is retained without under-drawal incentives above 50.05 Hz.'
      ],
      fullText: `THE GAZETTE OF INDIA: EXTRAORDINARY [PART III—SEC. 4]
CENTRAL ELECTRICITY REGULATORY COMMISSION NOTIFICATION
New Delhi, the 2024.
No. L-1/260/2021/CERC.—In exercise of the powers conferred by Section 178 of the Electricity Act, 2003, the Central Electricity Regulatory Commission hereby makes the following regulations:

1. Short title and commencement.
2. Definitions.
3. Reference Charge Rate & Contract Rate:
Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes.
4. Computation of Deviation Charges:
(iii) in respect of a WS seller or a MSW seller or such other entity as applicable, selling power through open access to a third party or in case of captive consumption of a captive generating plant based on renewable energy sources, the weighted average ACP of the Integrated-Day Ahead Market segments of all Power Exchanges for the respective time block;
(iv) in case of multiple contracts or transactions including captive consumption, the weighted average of the reference rates of all such contracts or transactions; (iv) in case of multiple contracts or transactions including captive consumption, the weighted average of the contract rates of all such contracts or transactions, as the case may be;
5. Settling Multiple Contracts through Single Meter:
In case of multiple contracts or transactions settled through a single boundary meter, deviation charges shall be calculated on the weighted average rate of all active contracts for that settlement period.
6. Frequency Dependent Deviation Schedule:
The charges for deviation when frequency fluctuates beyond standard operating bands (49.90 Hz to 50.05 Hz) shall follow the stepped schedule in Annexure-III.`
    },
    comments: [
      {
        number: 1,
        title: 'Contract Rate: Weighted Average Price Across Multiple Power Exchanges',
        body: 'In the proposed clause K(ii), a merchant generator may sell electricity through multiple power exchanges as well as through bilateral contracts. The draft regulation does not explicitly account for the weighted average price across all power exchanges for merchant generators selling through multiple exchanges or traders. We recommend modifying the clause to account for the weighted average price across all power exchanges and clarifying how sales through traders or bilateral arrangements would be incorporated into this calculation.',
        draft_quote: 'In case of merchant generators, reference charge rate shall be the contract rate or the Area Clearing Price (ACP) of the Day Ahead Market of the Power Exchange.',
        suggestion: 'We recommend modifying the clause to account for the weighted average price across all power exchanges and clarifying how sales through traders or bilateral arrangements would be incorporated into this calculation.'
      },
      {
        number: 2,
        title: 'Correction in the definition of Contract Rate (RR)',
        body: 'In the proposed clause K(iv), the definition of Reference Charge Rate (RR) should be clarified by adding the word "applicable" before "contract rate" to avoid ambiguities when multiple tariff structures apply.',
        draft_quote: 'Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes.',
        suggestion: 'The definition of Reference Charge Rate (RR) should be clarified by adding the word "applicable" before "contract rate" to avoid ambiguities when multiple tariff structures apply.'
      },
      {
        number: 3,
        title: 'Settling Multiple Contracts through a Single Meter',
        body: 'The evolving nature of power transactions allows generators to execute multiple contracts across inter-state and intra-state segments using a single delivery point and boundary meter. The draft regulation does not explicitly provide for the appropriation of deviation charges across inter-state and intra-state transactions in cases of multiple contracts or transactions through a single meter. The regulation should provide for the appropriation of deviation charges across inter-state and intra-state transactions based on weighted averages.',
        draft_quote: 'Where a seller or buyer has multiple open access transactions in a single time block, deviation settlement shall be computed against the scheduled energy of each contract separately, without inter-state or intra-state pooling.',
        suggestion: 'The regulation should provide for the appropriation of deviation charges across inter-state and intra-state transactions, especially in cases of multiple contracts or transactions through a single meter.'
      },
      {
        number: 4,
        title: 'HPERC DSM Proposal for Buyer Deviation Schedules',
        body: 'The stakeholder requested several changes including phased alignment with CERC\'s DSM framework, removal of under-drawal incentives above 50.09 Hz, alignment of over-drawal penalties with CERC\'s framework, reduction of under-drawal DSM penalties, introduction of a counterbalancing incentive for under-drawal when frequency overshoots 50 Hz, and enhancement of transparency through real-time monitoring dashboards and regular deviation reports.',
        draft_quote: 'Grid operators shall publish quarterly reports of deviation settlement charges collected across all regional pools.',
        suggestion: 'Phased alignment with CERC DSM framework, removal of under-drawal incentives above 50.09 Hz, alignment of over-drawal penalties with CERC framework, reduction of under-drawal DSM penalties, introduction of counterbalancing incentives, and real-time monitoring dashboards.'
      }
    ],
    results: [
      {
        comment_number: 1,
        comment_title: 'Contract Rate: Weighted Average Price Across Multiple Power Exchanges',
        classification: 'ACCEPTED',
        draft_position: 'The draft regulation did not explicitly account for the weighted average price across all power exchanges for merchant generators selling through multiple exchanges or traders.',
        requested_change: 'The stakeholder requested that the regulation be modified to account for the weighted average price across all power exchanges and to clarify how sales through traders or bilateral arrangements would be incorporated into this calculation.',
        final_position: 'The final regulation includes provisions for the weighted average ACP of all Power Exchanges for the respective time block and for the weighted average of contract rates of all contracts or transactions.',
        implemented_requests: [
          'Weighted average price calculation across all power exchanges',
          'Incorporation of sales through traders or bilateral arrangements into the weighted average price'
        ],
        not_implemented_requests: [],
        reasoning: 'The final regulation directly addresses both of the stakeholder\'s requests, providing for the use of a weighted average price across all power exchanges and clarifying the incorporation of various sales into this calculation.',
        evidence_in_final: '(iii) in respect of a WS seller or a MSW seller or such other entity as applicable, selling power through open access to a third party or in case of captive consumption of a captive generating plant based on renewable energy sources, the weighted average ACP of the Integrated-Day Ahead Market segments of all Power Exchanges for the respective time block; (iv) in case of multiple contracts or transactions including captive consumption, the weighted average of the reference rates of all such contracts or transactions;',
        referenced_clause: 'Annexure-I, Clause (iii) & (iv)',
        file_set: 'comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 100,
        evidence_paragraph_index: 2,
        evidence_source_clause: 'Annexure-I, Clause (iii)',
        evidence_matched_excerpt: 'Annexure-I, Clause (iii): "in respect of a WS seller or a MSW seller or such other entity as applicable, selling power through open access to a third party or in case of captive consumption of a captive generating plant based on renewable energy sources, the weighted average ACP of the Integrated-Day Ahead Market segments of all Power Exchanges for the respective time block;"',
        provenance: {
          source_doc: 'final',
          paragraph_index: 2,
          clause_heading: 'Annexure-I, Clause (iii)',
          exact_match: true,
          match_score: 100,
          text_snippet: 'Annexure-I, Clause (iii): "in respect of a WS seller or a MSW seller or such other entity as applicable, selling power through open access to a third party or in case of captive consumption..."'
        }
      },
      {
        comment_number: 2,
        comment_title: 'Correction in the definition of Contract Rate (RR)',
        classification: 'REJECTED',
        draft_position: 'The draft regulation does not explicitly provide the modified definition of Contract Rate (RR) as requested by the comment.',
        requested_change: 'Addition of the word "applicable" to the definition of Contract Rate (RR) for better legal clarification.',
        final_position: 'The final regulation provides detailed definitions of Reference Charge Rate and Contract rate but does not adopt the suggested wording amendment.',
        implemented_requests: [],
        not_implemented_requests: [
          'Addition of a word to the definition of Contract Rate (RR) for better clarification.'
        ],
        reasoning: 'The final regulation retains the established definition of Reference Charge Rate without incorporating the specific textual modification requested by the stakeholder.',
        evidence_in_final: 'Not found in final regulation (Retained verbatim from draft formulation)',
        referenced_clause: 'Regulation 7. Definition of Reference Charge Rate',
        file_set: 'comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 100,
        evidence_paragraph_index: 4,
        evidence_source_clause: 'Regulation 7',
        evidence_matched_excerpt: 'Regulation 7. Definition of Reference Charge Rate and Contract Rate: Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations for deviation settlement purposes. The Commission affirms the established legal definition without alteration.',
        provenance: {
          source_doc: 'final',
          paragraph_index: 4,
          clause_heading: 'Regulation 7',
          exact_match: true,
          match_score: 100,
          text_snippet: 'Regulation 7. Definition of Reference Charge Rate and Contract Rate: Reference Charge Rate (RR) means the rate determined in accordance with the provisions of these regulations...'
        }
      },
      {
        comment_number: 3,
        comment_title: 'Settling Multiple Contracts through a Single Meter',
        classification: 'ACCEPTED',
        draft_position: 'The draft regulation did not explicitly provide for the appropriation of deviation charges across inter-state and intra-state transactions in cases of multiple contracts or transactions through a single meter.',
        requested_change: 'The stakeholder requests that the regulation should provide for the appropriation of deviation charges across inter-state and intra-state transactions, especially in cases of multiple contracts or transactions through a single meter.',
        final_position: 'The final regulation includes provisions for the appropriation of deviation charges in cases of multiple contracts or transactions, including captive consumption, through the calculation of weighted averages of reference rates or contract rates.',
        implemented_requests: [
          'Appropriation of deviation charges for multiple contracts or transactions through single boundary meter'
        ],
        not_implemented_requests: [],
        reasoning: 'The final regulation directly addresses the stakeholder\'s request by including clauses that provide for the appropriation of deviation charges in cases of multiple contracts or transactions.',
        evidence_in_final: 'Regulation 12. Settlement for Entities with Single Meter Multi-Contract: The deviation settlement for entities scheduling power under multiple contracts across inter-state and intra-state segments through a single metering point shall be apportioned on the basis of weighted average contract rates.',
        referenced_clause: 'Regulation 12 / Annexure-I(iv)',
        file_set: 'comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 100,
        evidence_paragraph_index: 5,
        evidence_source_clause: 'Regulation 12',
        evidence_matched_excerpt: 'Regulation 12. Settlement for Entities with Single Meter Multi-Contract: The deviation settlement for entities scheduling power under multiple contracts across inter-state and intra-state segments through a single metering point shall be apportioned on the basis of weighted average contract rates.',
        provenance: {
          source_doc: 'final',
          paragraph_index: 5,
          clause_heading: 'Regulation 12',
          exact_match: true,
          match_score: 100,
          text_snippet: 'Regulation 12. Settlement for Entities with Single Meter Multi-Contract: The deviation settlement for entities scheduling power under multiple contracts across inter-state...'
        }
      },
      {
        comment_number: 4,
        comment_title: 'HPERC DSM Proposal for Buyer Deviation Schedules',
        classification: 'REJECTED',
        draft_position: 'The draft regulation did not adopt the complex multi-tiered frequency linked incentive mechanism requested by the stakeholder.',
        requested_change: 'The stakeholder requested several changes including phased alignment with CERC\'s DSM framework, removal of under-drawal incentives above 50.09 Hz, alignment of over-drawal penalties with CERC\'s framework, reduction of under-drawal DSM penalties, introduction of a counterbalancing incentive for under-drawal when frequency overshoots 50 Hz, and enhancement of transparency.',
        final_position: 'The final regulation introduces standard charges for deviations based on frequency bands but did not adopt the specific structural incentive formula or the real-time telemetry dashboard request.',
        implemented_requests: [],
        not_implemented_requests: [
          'Phased alignment with CERC\'s DSM framework',
          'Removal of under-drawal incentives above 50.09 Hz',
          'Alignment of over-drawal penalties with CERC\'s framework',
          'Reduction of under-drawal DSM penalties',
          'Introduction of a counterbalancing incentive for under-drawal when frequency overshoots 50 Hz',
          'Enhancement of transparency through real-time monitoring dashboards and regular deviation reports'
        ],
        reasoning: 'The final regulation did not introduce the proposed custom penalty-offset curves or dashboard mandates, retaining the baseline frequency response framework.',
        evidence_in_final: 'Not found in final regulation',
        referenced_clause: 'Regulation 15. Frequency-dependent Charges',
        file_set: 'comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 90,
        evidence_paragraph_index: 6,
        evidence_source_clause: 'Regulation 15',
        evidence_matched_excerpt: 'Regulation 15. Frequency-dependent Charges: The charges for deviation when frequency deviates below 49.90 Hz or above 50.05 Hz shall be levied based on the graded system in Schedule A. The standard penalty matrix is retained without under-drawal incentives above 50.05 Hz.',
        provenance: {
          source_doc: 'final',
          paragraph_index: 6,
          clause_heading: 'Regulation 15',
          exact_match: true,
          match_score: 90,
          text_snippet: 'Regulation 15. Frequency-dependent Charges: The charges for deviation when frequency deviates below 49.90 Hz or above 50.05 Hz shall be levied based on the graded system...'
        }
      }
    ]
  },
  {
    id: 'rerc-rpo-2024',
    name: 'RERC Renewable Purchase Obligation (RPO)',
    description: 'State Electricity Regulatory Commission regulations concerning Virtual Power Purchase Agreements (VPPAs) and Renewable Energy Certificate (REC) compliance.',
    draftDoc: {
      id: 'draft-rerc-rpo',
      title: 'Draft RERC Renewable Energy Compliance Regulations',
      fileName: 'rerc_draft.pdf',
      paragraphs: [
        'Regulation 4. Virtual Power Purchase Agreements: (1) Obligated entities may fulfill their RPO through physical procurement of renewable power or through purchase of Renewable Energy Certificates.',
        'Regulation 7. Trading of Surplus Certificates: (2) Certificates generated in excess of the annual obligation shall lapse at the end of the settlement financial year and shall not be carried forward or traded on power exchanges.',
        'Regulation 11. Energy Storage Integration: (1) Obligated entities using battery energy storage systems (BESS) charged via renewable generation shall be eligible for RPO credit based on gross charging energy.'
      ],
      fullText: `Rajasthan Electricity Regulatory Commission (RPO Compliance) Draft Regulations.
Regulation 4: Virtual Power Purchase Agreements. Obligated entities may fulfill their RPO through physical procurement of renewable power or through purchase of Renewable Energy Certificates.
Regulation 7: Trading of Surplus Certificates. Certificates generated in excess of the annual obligation shall lapse at the end of the settlement financial year and shall not be carried forward or traded on power exchanges.
Regulation 11: Energy Storage Integration. Obligated entities using battery energy storage systems (BESS) charged via renewable generation shall be eligible for RPO credit based on gross charging energy.`
    },
    finalDoc: {
      id: 'final-rerc-rpo',
      title: 'Final RERC Renewable Energy Compliance Regulations',
      fileName: 'rerc_final.pdf',
      paragraphs: [
        'Regulation 4. Recognition of Virtual Power Purchase Agreements: (1) Obligated entities may satisfy their Renewable Purchase Obligation (RPO) and Energy Storage Obligation (ESO) through Virtual Power Purchase Agreements (VPPAs) executed with renewable power developers without requiring physical wheeling of electricity.',
        'Regulation 7. Treatment of Surplus RECs: (2) Surplus Renewable Energy Certificates (RECs) shall not be eligible for secondary commercial trading; however, obligated entities may carry forward surplus RECs for up to two consecutive compliance cycles.',
        'Regulation 11. Storage Accounting: (1) RPO accounting for battery storage systems shall be computed strictly on net discharge energy delivered to the distribution grid.'
      ],
      fullText: `Rajasthan Electricity Regulatory Commission Gazette Notification.
Regulation 4: Recognition of Virtual Power Purchase Agreements. Obligated entities may satisfy their Renewable Purchase Obligation (RPO) and Energy Storage Obligation (ESO) through Virtual Power Purchase Agreements (VPPAs) executed with renewable power developers without requiring physical wheeling of electricity.
Regulation 7: Treatment of Surplus RECs. Surplus Renewable Energy Certificates (RECs) shall not be eligible for secondary commercial trading; however, obligated entities may carry forward surplus RECs for up to two consecutive compliance cycles.
Regulation 11: Storage Accounting. RPO accounting for battery storage systems shall be computed strictly on net discharge energy delivered to the distribution grid.`
    },
    comments: [
      {
        number: 1,
        title: 'Explicit Recognition of VPPAs for RPO/ESO Compliance',
        body: 'We strongly suggest that Virtual Power Purchase Agreements (VPPAs) be formally recognized as an eligible compliance instrument for fulfilling Renewable Purchase Obligations (RPO) and Energy Storage Obligations (ESO) without physical grid wheeling.',
        draft_quote: 'Obligated entities may fulfill their RPO through physical procurement of renewable power or through purchase of Renewable Energy Certificates.',
        suggestion: 'Formally recognize Virtual Power Purchase Agreements (VPPAs) for RPO and ESO compliance without physical grid wheeling.'
      },
      {
        number: 2,
        title: 'Allowing Commercial Trading and Carry-forward of Surplus RECs',
        body: 'Stakeholder recommends allowing obligated entities with surplus RECs to trade them on power exchanges to monetize excess compliance, as well as allowing surplus RECs to be carried forward to subsequent compliance years.',
        draft_quote: 'Certificates generated in excess of the annual obligation shall lapse at the end of the settlement financial year and shall not be carried forward or traded on power exchanges.',
        suggestion: 'Allow commercial trading of surplus RECs on power exchanges AND permit multi-year carry-forward of surplus RECs.'
      }
    ],
    results: [
      {
        comment_number: 1,
        comment_title: 'Explicit Recognition of VPPAs for RPO/ESO Compliance',
        classification: 'ACCEPTED',
        draft_position: 'The draft regulation only permitted physical power procurement or standard REC purchase for RPO compliance.',
        requested_change: 'Stakeholder requested explicit recognition of Virtual Power Purchase Agreements (VPPAs) for RPO and ESO compliance without physical grid wheeling.',
        final_position: 'The final regulation explicitly provides that obligated entities may satisfy RPO and ESO through VPPAs without requiring physical wheeling of electricity.',
        implemented_requests: [
          'Recognition of VPPAs for RPO and ESO compliance',
          'Exemption from physical wheeling requirement'
        ],
        not_implemented_requests: [],
        reasoning: 'The final regulation adopts the exact policy mechanism requested by adding an explicit VPPA clause in Regulation 4.',
        evidence_in_final: 'Regulation 4(1): "Obligated entities may satisfy their Renewable Purchase Obligation (RPO) and Energy Storage Obligation (ESO) through Virtual Power Purchase Agreements (VPPAs) executed with renewable power developers without requiring physical wheeling of electricity."',
        referenced_clause: 'Regulation 4',
        file_set: 'rerc_comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 100,
        evidence_paragraph_index: 1,
        evidence_source_clause: 'Regulation 4. Recognition of Virtual Power Purchase Agreements',
        evidence_matched_excerpt: 'Regulation 4. Recognition of Virtual Power Purchase Agreements: (1) Obligated entities may satisfy their Renewable Purchase Obligation (RPO) and Energy Storage Obligation (ESO) through Virtual Power Purchase Agreements (VPPAs) executed with renewable power developers without requiring physical wheeling of electricity.',
        provenance: {
          source_doc: 'final',
          paragraph_index: 1,
          clause_heading: 'Regulation 4',
          exact_match: true,
          match_score: 100,
          text_snippet: 'Regulation 4. Recognition of Virtual Power Purchase Agreements: (1) Obligated entities may satisfy their Renewable Purchase Obligation (RPO)...'
        }
      },
      {
        comment_number: 2,
        comment_title: 'Allowing Commercial Trading and Carry-forward of Surplus RECs',
        classification: 'PARTIALLY_ACCEPTED',
        draft_position: 'Draft provided that surplus RECs would lapse immediately with no carry forward or trading.',
        requested_change: 'Allow commercial trading of surplus RECs on power exchanges and allow multi-year carry-forward of surplus RECs.',
        final_position: 'The final regulation permits carrying forward surplus RECs for up to two consecutive compliance cycles, but explicitly rejects commercial secondary trading.',
        implemented_requests: [
          'Carry-forward of surplus RECs for up to two compliance cycles'
        ],
        not_implemented_requests: [
          'Commercial secondary trading of surplus RECs on power exchanges'
        ],
        reasoning: 'The regulator accepted the carry-forward recommendation to prevent expiration of compliance credits, but rejected the commercial trading request.',
        evidence_in_final: 'Regulation 7(2): "Surplus Renewable Energy Certificates (RECs) shall not be eligible for secondary commercial trading; however, obligated entities may carry forward surplus RECs for up to two consecutive compliance cycles."',
        referenced_clause: 'Regulation 7(2)',
        file_set: 'rerc_comments.pdf',
        evidence_verified: true,
        evidence_match_confidence: 100,
        evidence_paragraph_index: 2,
        evidence_source_clause: 'Regulation 7. Treatment of Surplus RECs',
        evidence_matched_excerpt: 'Regulation 7. Treatment of Surplus RECs: (2) Surplus Renewable Energy Certificates (RECs) shall not be eligible for secondary commercial trading; however, obligated entities may carry forward surplus RECs for up to two consecutive compliance cycles.',
        provenance: {
          source_doc: 'final',
          paragraph_index: 2,
          clause_heading: 'Regulation 7',
          exact_match: true,
          match_score: 100,
          text_snippet: 'Regulation 7. Treatment of Surplus RECs: (2) Surplus Renewable Energy Certificates (RECs) shall not be eligible for secondary commercial trading; however, obligated entities may carry forward...'
        }
      }
    ]
  }
];
